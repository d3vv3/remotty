export type ConnectionState = "connecting" | "online" | "unstable" | "offline" | "disconnected"
export type RelayHealth = { lastContact?: number; rtt?: number; timedOut?: boolean }
export type ConnectionTone = "online" | "unstable" | "offline"
export type ConnectionPresentation = { state: ConnectionTone | "connecting"; label: string; tone: ConnectionTone; hasTimedOutRelay: boolean }
export type ConnectionRowPresentation = { state: ConnectionTone; label: string; detail: string }

export const reconnectDelay = (attempt: number, random = Math.random) => {
  const base = Math.min(30_000, 1_000 * 2 ** Math.max(0, attempt))
  return Math.round(base * (0.8 + random() * 0.4))
}

export const RESUME_SUSPENSION_MS = 5_000
export const HANDSHAKE_TIMEOUT_MS = 10_000

export const isTransportActivityStale = (lastActivityAt: number | undefined, now: number, threshold = RESUME_SUSPENSION_MS) =>
  lastActivityAt === undefined || now - lastActivityAt >= threshold

export const shouldReplaceTransportOnResume = ({
  socketOpen,
  now,
  hiddenAt,
  lastTransportActivity,
  persisted = false,
  online = false,
}: {
  socketOpen: boolean
  now: number
  hiddenAt?: number
  lastTransportActivity?: number
  persisted?: boolean
  online?: boolean
}) => {
  if (!socketOpen || online) return true
  if (persisted) return isTransportActivityStale(lastTransportActivity, now)
  if (hiddenAt !== undefined) return now - hiddenAt >= RESUME_SUSPENSION_MS
  return false
}

export const shouldReconnectTransportOnResume = (socketConnecting: boolean, resume: Parameters<typeof shouldReplaceTransportOnResume>[0]) =>
  !socketConnecting && shouldReplaceTransportOnResume(resume)

export const shouldExpireHandshakeWatchdog = (generation: number, currentGeneration: number, authenticated: boolean) =>
  generation === currentGeneration && !authenticated

export const exactConnectionTime = (time: number, now: number) => {
  const elapsed = Math.max(0, now - time)
  if (elapsed < 1_000) return `${Math.floor(elapsed)} ms ago`
  const seconds = Math.floor(elapsed / 1_000)
  return `${seconds} ${seconds === 1 ? "second" : "seconds"} ago`
}

export const hasSequenceGap = (current: number | undefined, next: number) =>
  current !== undefined && next > current + 1

export const effectiveConnectionPresentation = (
  state: ConnectionState,
  connectedRelayIds: Iterable<string>,
  relayCount: number,
  health: Record<string, RelayHealth>,
): ConnectionPresentation => {
  const hasTimedOutRelay = healthSummary(connectedRelayIds, health)
  if (state === "online" && relayCount && !hasTimedOutRelay) return { state: "online", label: "Live", tone: "online", hasTimedOutRelay }
  if (state === "connecting") return { state: "connecting", label: "Connecting", tone: "offline", hasTimedOutRelay }
  if (state === "unstable" || hasTimedOutRelay) return { state: "unstable", label: "Unstable", tone: "unstable", hasTimedOutRelay }
  return { state: "offline", label: "Offline", tone: "offline", hasTimedOutRelay }
}

export const relayConnectionPresentation = (connected: boolean, health: RelayHealth | undefined, now: number): ConnectionRowPresentation => {
  if (!connected) return { state: "offline", label: "Offline", detail: health?.rtt !== undefined ? `${health.rtt} ms` : health?.lastContact ? `Last contact ${exactConnectionTime(health.lastContact, now)}` : "" }
  if (health?.timedOut) return { state: "unstable", label: "Unstable", detail: health.lastContact ? `Last contact ${exactConnectionTime(health.lastContact, now)}` : "" }
  return { state: "online", label: "Connected", detail: health?.rtt !== undefined ? `${health.rtt} ms` : health?.lastContact ? `Last contact ${exactConnectionTime(health.lastContact, now)}` : "" }
}

export const serviceConnectionPresentation = (serviceConnected: boolean, overall: ConnectionPresentation): ConnectionRowPresentation => {
  if (!serviceConnected) return { state: "offline", label: "Unreachable", detail: "" }
  if (overall.state === "unstable" && !overall.hasTimedOutRelay) return { state: "unstable", label: "Unstable", detail: "" }
  return { state: "online", label: "Connected", detail: "" }
}

export const connectionLabel = (state: ConnectionState, relayCount: number, timedOut: boolean) =>
  effectiveConnectionPresentation(state, timedOut ? ["timed-out"] : [], relayCount, timedOut ? { "timed-out": { timedOut } } : {}).label

import { MAX_CANONICAL_MESSAGE_BYTES } from "@remotty/protocol"

export const mergeByMessageId = <T extends { info: { id: string; time?: { created?: number } } }>(current: T[], incoming: T[]) => {
  const merged = new Map(current.map((message) => [message.info.id, message]))
  for (const message of incoming) {
    const existing = merged.get(message.info.id)
    if (!existing) { merged.set(message.info.id, message); continue }
    const info = { ...existing.info, ...message.info } as typeof message.info & { delivery?: unknown }
    if (!("delivery" in message.info)) delete info.delivery
    merged.set(message.info.id, { ...existing, ...message, info })
  }
  return [...merged.values()].sort((left, right) => (left.info.time?.created ?? 0) - (right.info.time?.created ?? 0))
}

export const mergeCachedMessages = <T extends { info: { id: string; time?: { created?: number } } }>(live: T[], cached: T[]) =>
  mergeByMessageId(cached, live)

export const reconcileCanonicalMessages = <T extends { info: { id: string; time?: { created?: number }; delivery?: unknown } }>(local: T[], canonical: T[]) => {
  const localById = new Map(local.map((message) => [message.info.id, message]))
  const canonicalIds = new Set(canonical.map((message) => message.info.id))
  const reconciled = canonical.map((message) => {
    const existing = localById.get(message.info.id)
    if (!existing) return message
    const info = { ...existing.info, ...message.info } as T["info"] & { delivery?: unknown }
    delete info.delivery
    return { ...existing, ...message, info }
  })
  // An acknowledgement only proves the relay accepted the prompt; it does not prove the
  // next 80-message snapshot already contains it.
  return [...reconciled, ...local.filter((message) => !canonicalIds.has(message.info.id) && message.info.delivery !== undefined)]
}

export type ChunkAssembly = { total?: number; chunks: Map<number, unknown>; fragments: Map<string, { total: number; bytes: Map<number, string>; received: Set<number>; chunkIndex: number; byteLength: number }> }
export const createChunkAssembly = (): ChunkAssembly => ({ chunks: new Map(), fragments: new Map() })

const decodeBase64 = (value: string) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0))

export const addChunk = (assembly: ChunkAssembly, chunk: { index: number; total: number; result?: unknown }) => {
  if (!Number.isInteger(chunk.index) || !Number.isInteger(chunk.total) || chunk.total < 1 || chunk.total > 4_096 || chunk.index < 0 || chunk.index >= chunk.total) return false
  if (assembly.total !== undefined && assembly.total !== chunk.total) return false
  assembly.total = chunk.total
  const fragment = typeof chunk.result === "object" && chunk.result !== null
    ? (chunk.result as { fragment?: { messageId?: unknown; index?: unknown; total?: unknown; bytes?: unknown } }).fragment
    : undefined
  if (!fragment) {
    if (assembly.chunks.has(chunk.index) && JSON.stringify(assembly.chunks.get(chunk.index)) !== JSON.stringify(chunk.result)) return false
    assembly.chunks.set(chunk.index, chunk.result)
    return true
  }
  const messageId = fragment?.messageId
  const index = fragment?.index
  const total = fragment?.total
  const bytesValue = fragment?.bytes
  if (typeof messageId !== "string" || typeof index !== "number" || typeof total !== "number" || typeof bytesValue !== "string" ||
    !Number.isInteger(index) || !Number.isInteger(total) || index < 0 || total < 1 || total > 4_096 || index >= total) return false
  let decoded: Uint8Array
  try { decoded = decodeBase64(bytesValue) } catch { return false }
  const current = assembly.fragments.get(messageId) ?? { total, bytes: new Map(), received: new Set(), chunkIndex: chunk.index, byteLength: 0 }
  if (current.total !== total) return false
  const previous = current.bytes.get(index)
  if (previous !== undefined && previous !== bytesValue) return false
  if (previous === undefined) {
    if (current.byteLength + decoded.length > MAX_CANONICAL_MESSAGE_BYTES) return false
    current.bytes.set(index, bytesValue)
    current.received.add(index)
    current.byteLength += decoded.length
  }
  if (assembly.chunks.has(chunk.index) && !Array.isArray(assembly.chunks.get(chunk.index))) return false
  assembly.chunks.set(chunk.index, [])
  assembly.fragments.set(messageId, current)
  if (current.received.size === current.total) {
    const totalBytes = current.byteLength
    const bytes = new Uint8Array(totalBytes)
    let offset = 0
    try {
      for (let fragmentIndex = 0; fragmentIndex < current.total; fragmentIndex += 1) {
        const value = current.bytes.get(fragmentIndex)
        if (value === undefined) return false
        const fragmentBytes = decodeBase64(value); bytes.set(fragmentBytes, offset); offset += fragmentBytes.length
      }
      const decodedMessage = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
      if (!decodedMessage || typeof decodedMessage !== "object") return false
      const id = (decodedMessage as { info?: { id?: unknown } }).info?.id
      if (id !== messageId) return false
      assembly.chunks.set(current.chunkIndex, [decodedMessage])
    } catch { return false }
  }
  return true
}

export const completeChunks = (assembly: ChunkAssembly) => assembly.total !== undefined && [...Array(assembly.total).keys()].every((index) => assembly.chunks.has(index))
export const assembledMessages = (assembly: ChunkAssembly) => [...assembly.chunks.entries()].sort(([left], [right]) => left - right).flatMap(([, value]) => Array.isArray(value) ? value : [])

export const exactManifestMessages = (messages: unknown[], ids: string[]) => {
  if (messages.length !== ids.length) return undefined
  const byId = new Map<string, unknown>()
  for (const message of messages) {
    const id = message && typeof message === "object" && !Array.isArray(message) ? (message as { info?: { id?: unknown } }).info?.id : undefined
    if (typeof id !== "string" || byId.has(id)) return undefined
    byId.set(id, message)
  }
  return ids.every((id) => byId.has(id)) ? ids.map((id) => byId.get(id)!) : undefined
}

export const validManifest = (value: unknown) => {
  const manifest = value as { manifest?: unknown; ids?: unknown; total?: unknown }
  const total = manifest?.total
  if (manifest?.manifest !== true || !Array.isArray(manifest.ids) || manifest.ids.length > 80 || typeof total !== "number" || !Number.isInteger(total) || total < 1 || total > 4_096) return undefined
  if (!manifest.ids.every((id) => typeof id === "string" && id.length > 0) || new Set(manifest.ids).size !== manifest.ids.length) return undefined
  return { ids: manifest.ids as string[], total }
}

export const orderByManifest = <T extends { info?: { id?: string } }>(messages: T[], ids: string[]) => {
  const byId = new Map(messages.map((message) => [message.info?.id, message]))
  return ids.flatMap((id) => byId.has(id) ? [byId.get(id)!] : [])
}

export const readOnlyCommand = (type: string) =>
  ["snapshot.request", "session.messages", "session.todos", "session.diff", "workspace.diff", "workspace.diff.patch", "relay.ping"].includes(type)

export const retryPlan = (now: number, deadline: number, attempts: number) => attempts < 2 && now < deadline
export const requestInactivityMs = (type: string) => type === "relay.ping" ? 8_000 : ["session.messages", "workspace.diff", "workspace.diff.patch"].includes(type) ? 20_000 : 15_000
export const healthSummary = (connected: Iterable<string>, health: Record<string, RelayHealth>) => [...connected].some((relayId) => health[relayId]?.timedOut)
export const promptDeliveryState = (message: string): "uncertain" | "failed" => /Connection interrupted|relay did not respond|Relay is offline|workspace relay disconnected|socket (?:closed|replaced)|transport (?:closed|lost)/i.test(message) ? "uncertain" : "failed"
