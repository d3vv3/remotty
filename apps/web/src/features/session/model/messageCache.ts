import { canonicalJsonFingerprint, canonicalMessageValue, type JsonValue, type MessageDeltaManifest } from "@remotty/protocol"

export type MessageWithId = { info: { id: string; delivery?: string } }
export type CachedMessageRecord<T extends MessageWithId = MessageWithId> = { message: T; fingerprint: string }
export type PreparedMessageRecord<T extends MessageWithId = MessageWithId> = { id: string; record: CachedMessageRecord<T> }
export type PreparedCanonicalMessages<T extends MessageWithId = MessageWithId> = { manifest: MessageDeltaManifest; records: PreparedMessageRecord<T>[] }
export type MessageCache<T extends MessageWithId = MessageWithId> = {
  version: 2
  canonical: { manifest: Array<{ id: string; fingerprint: string }>; records: Record<string, CachedMessageRecord<T>>; syncedAt: number }
  staged: { records: Record<string, CachedMessageRecord<T>> }
  local: { messages: T[]; acceptedMisses?: Record<string, number> }
}

export const MESSAGE_CACHE_SAVE_FAILURE_PREFIX = "Messages are current, but local cache could not be saved: "
export const CACHE_FAILURE_COOLDOWN_MS = 6_000
export type CacheFailure = { message: string; at: number }

/** Allows repeated storage failures to be visible after the global error display expires. */
export const shouldReportCacheFailure = (
  previous: CacheFailure | undefined,
  message: string,
  now: number,
  cooldown = CACHE_FAILURE_COOLDOWN_MS,
) => !previous || previous.message !== message || now - previous.at >= cooldown

/** Produces a useful storage diagnostic without assuming the rejection is an Error. */
export const messageCacheErrorDetail = (cause: unknown) => {
  if (cause instanceof Error) {
    const message = cause.message || "Unknown error"
    return cause.name && cause.name !== "Error" ? `${cause.name}: ${message}` : message
  }
  if (cause && typeof cause === "object") {
    const value = cause as { name?: unknown; message?: unknown }
    const name = typeof value.name === "string" && value.name ? value.name : undefined
    const message = typeof value.message === "string" && value.message ? value.message : undefined
    if (name && message) return `${name}: ${message}`
    return name ?? message ?? "Unknown error"
  }
  return typeof cause === "string" && cause ? cause : "Unknown error"
}

export const formatMessageCacheSaveFailure = (cause: unknown) =>
  `${MESSAGE_CACHE_SAVE_FAILURE_PREFIX}${messageCacheErrorDetail(cause)}`

export const isMessageCacheSaveFailure = (cause: unknown) =>
  cause instanceof Error && cause.message.startsWith(MESSAGE_CACHE_SAVE_FAILURE_PREFIX)

const asJson = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue
export const emptyMessageCache = <T extends MessageWithId>(): MessageCache<T> => ({ version: 2, canonical: { manifest: [], records: {}, syncedAt: 0 }, staged: { records: {} }, local: { messages: [] } })

export const migrateMessageCache = async <T extends MessageWithId>(value: unknown): Promise<MessageCache<T>> => {
  if (value && typeof value === "object" && (value as MessageCache<T>).version === 2) return value as MessageCache<T>
  const cache = emptyMessageCache<T>()
  if (Array.isArray(value)) for (const message of value) {
    const id = message?.info?.id
    if (typeof id !== "string" || !id || cache.canonical.records[id] || cache.local.messages.some((item) => item.info.id === id)) continue
    if (message.info?.delivery || message.info?.legacyPrompt) cache.local.messages.push(message as T)
    else {
      const record = await stageMessage(cache, message as T)
      cache.staged = record.staged
      const staged = cache.staged.records[id]!
      cache.canonical.records[id] = staged
      cache.canonical.manifest.push({ id, fingerprint: staged.fingerprint })
      delete cache.staged.records[id]
    }
  }
  return cache
}

export const messageInventory = <T extends MessageWithId>(cache: MessageCache<T>) => {
  const records = { ...cache.canonical.records, ...cache.staged.records }
  return Object.entries(records).flatMap(([id, record]) => record?.message?.info?.id === id ? [{ id, fingerprint: record.fingerprint }] : []).slice(0, 80)
}

export const verifyDeltaSnapshot = async (manifest: MessageDeltaManifest) =>
  manifest.snapshotId === await canonicalJsonFingerprint({ version: 1, scope: manifest.scope, manifest: manifest.manifest })

/** Pure ownership guard for overlapping session refreshes. */
export const commitManifestForRefresh = <T extends MessageWithId>(cache: MessageCache<T>, owner: number, currentOwner: number, manifest: MessageDeltaManifest) =>
  owner === currentOwner ? commitMessageManifest(cache, manifest) : undefined

export const stageMessage = async <T extends MessageWithId>(cache: MessageCache<T>, message: T, fingerprint?: string): Promise<MessageCache<T>> => {
  const id = message.info.id
  const actual = await canonicalJsonFingerprint(canonicalMessageValue(asJson(message)))
  if (fingerprint && fingerprint !== actual) throw new Error("Message fingerprint did not match its body")
  const records = { ...cache.staged.records }
  delete records[id]
  records[id] = { message, fingerprint: actual }
  return { ...cache, staged: { records } }
}

/** Fingerprints an ordered progress snapshot without capturing a mutable cache. */
export const prepareMessageProgress = async <T extends MessageWithId>(messages: T[]): Promise<PreparedMessageRecord<T>[]> => {
  const records = new Map<string, CachedMessageRecord<T>>()
  for (const message of messages) {
    const fingerprint = await canonicalJsonFingerprint(canonicalMessageValue(asJson(message)))
    records.delete(message.info.id)
    records.set(message.info.id, { message, fingerprint })
  }
  return [...records.entries()].map(([id, record]) => ({ id, record }))
}

/** Applies already fingerprinted progress records to the latest cache without restoring stale state. */
export const applyPreparedMessageProgress = <T extends MessageWithId>(cache: MessageCache<T>, records: PreparedMessageRecord<T>[]): MessageCache<T> => {
  const staged = { ...cache.staged.records }
  for (const { id, record } of records) {
    if (record.message.info.id !== id) throw new Error("Prepared message id did not match its body")
    delete staged[id]
    staged[id] = record
  }
  return { ...cache, staged: { records: staged } }
}

/** Re-stages a cumulative, already canonical-ordered progress snapshot. */
export const stageMessageProgress = async <T extends MessageWithId>(cache: MessageCache<T>, messages: T[]): Promise<MessageCache<T>> =>
  applyPreparedMessageProgress(cache, await prepareMessageProgress(messages))

export const commitMessageManifest = <T extends MessageWithId>(cache: MessageCache<T>, manifest: MessageDeltaManifest): MessageCache<T> | undefined => {
  const available = { ...cache.canonical.records, ...cache.staged.records }
  const records: Record<string, CachedMessageRecord<T>> = {}
  for (const entry of manifest.manifest) {
    const record = available[entry.id]
    if (!record || record.fingerprint !== entry.fingerprint) return undefined
    records[entry.id] = record
  }
  const canonicalIds = new Set(manifest.manifest.map((entry) => entry.id))
  return {
    version: 2,
    canonical: { manifest: manifest.manifest, records, syncedAt: Date.now() },
    staged: { records: {} },
    local: (() => {
      const acceptedMisses = { ...cache.local.acceptedMisses }
      const claimedLegacyIds = new Set<string>()
      const messages = cache.local.messages.flatMap((message) => {
        const localInfo = message.info as { id: string; delivery?: string; legacyPrompt?: boolean; knownMessageIds?: string[] }
        const localText = (message as { parts?: Array<{ type?: string; text?: string }> }).parts?.find((part) => part.type === "text")?.text
        const knownMessageIds = new Set(localInfo.knownMessageIds ?? [])
        const canonicalLegacyMatch = localInfo.legacyPrompt && localText && Object.entries(records).find(([id, record]) => {
          const candidate = record.message as { info?: { id?: string; role?: string }; parts?: Array<{ type?: string; text?: string }> }
          return candidate.info?.role === "user" && !claimedLegacyIds.has(id) && !knownMessageIds.has(candidate.info.id ?? "") && candidate.parts?.some((part) => part.type === "text" && part.text === localText)
        })
        if (canonicalLegacyMatch) claimedLegacyIds.add(canonicalLegacyMatch[0])
        if (canonicalIds.has(message.info.id) || canonicalLegacyMatch) { delete acceptedMisses[message.info.id]; return [] }
        if (message.info.delivery !== "accepted") return [message]
        // One completed tail may legitimately lag acknowledgement. On the second
        // miss preserve the text but stop representing it as indefinitely accepted.
        const misses = (acceptedMisses[message.info.id] ?? 0) + 1
        acceptedMisses[message.info.id] = misses
        return [misses >= 2 ? { ...message, info: { ...message.info, delivery: "uncertain" } } : message]
      })
      return { messages, acceptedMisses }
    })(),
  }
}

/** Converts a complete legacy/chunk response into the same canonical cache shape as delta. */
export const replaceCanonicalMessages = async <T extends MessageWithId>(cache: MessageCache<T>, messages: T[]): Promise<MessageCache<T>> => {
  const prepared = await prepareCanonicalMessages(messages)
  const committed = commitPreparedCanonicalMessages(cache, prepared)
  if (!committed) throw new Error("Could not construct canonical message cache")
  return committed
}

/** Builds a self-contained canonical snapshot that can later be committed against the latest local state. */
export const prepareCanonicalMessages = async <T extends MessageWithId>(messages: T[]): Promise<PreparedCanonicalMessages<T>> => {
  const records: PreparedMessageRecord<T>[] = []
  const manifest = [] as Array<{ id: string; fingerprint: string }>
  for (const message of messages) {
    const fingerprint = await canonicalJsonFingerprint(canonicalMessageValue(asJson(message)))
    if (manifest.some((entry) => entry.id === message.info.id)) throw new Error("Legacy messages require unique ids")
    const record = { message, fingerprint }
    records.push({ id: message.info.id, record })
    manifest.push({ id: message.info.id, fingerprint: record.fingerprint })
  }
  const snapshotId = await canonicalJsonFingerprint({ version: 1, scope: { kind: "tail", limit: 80 }, manifest })
  return { manifest: { version: 1, scope: { kind: "tail", limit: 80 }, manifest, upserts: manifest.map((entry) => entry.id), chunkCount: 1, snapshotId }, records }
}

/** Commits a prepared legacy snapshot while reconciling the current cache's local state exactly once. */
export const commitPreparedCanonicalMessages = <T extends MessageWithId>(cache: MessageCache<T>, prepared: PreparedCanonicalMessages<T>) =>
  commitMessageManifest(applyPreparedMessageProgress(cache, prepared.records), prepared.manifest)

export const visibleCachedMessages = <T extends MessageWithId>(cache: MessageCache<T>) => {
  const manifestIds = new Set(cache.canonical.manifest.map((entry) => entry.id))
  const canonical = cache.canonical.manifest.flatMap((entry) => {
    const record = cache.staged.records[entry.id] ?? cache.canonical.records[entry.id]
    return record ? [record.message] : []
  })
  const staged = Object.values(cache.staged.records).map((record) => record.message).filter((message) => !manifestIds.has(message.info.id))
  const visible = [...canonical, ...staged]
  const visibleIds = new Set(visible.map((message) => message.info.id))
  for (const message of cache.local.messages.filter((item) => !visibleIds.has(item.info.id))) {
    const knownMessageIds = (message.info as { knownMessageIds?: string[] }).knownMessageIds
    if (!knownMessageIds) {
      const created = (message.info as { time?: { created?: number } }).time?.created
      if (typeof created !== "number") {
        visible.push(message)
        continue
      }
      let insertAt = 0
      for (const [index, item] of visible.entries()) {
        const itemCreated = (item.info as { time?: { created?: number } }).time?.created
        if (typeof itemCreated === "number" && itemCreated <= created) insertAt = index + 1
      }
      visible.splice(insertAt, 0, message)
      continue
    }
    const known = new Set(knownMessageIds)
    let insertAt = 0
    for (const [index, item] of visible.entries()) if (known.has(item.info.id)) insertAt = index + 1
    visible.splice(insertAt, 0, message)
  }
  return visible
}
