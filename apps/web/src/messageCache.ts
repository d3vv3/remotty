import { canonicalJsonFingerprint, canonicalMessageValue, type JsonValue, type MessageDeltaManifest } from "@remotty/protocol"

export type MessageWithId = { info: { id: string; delivery?: string } }
export type CachedMessageRecord<T extends MessageWithId = MessageWithId> = { message: T; fingerprint: string }
export type MessageCache<T extends MessageWithId = MessageWithId> = {
  version: 2
  canonical: { manifest: Array<{ id: string; fingerprint: string }>; records: Record<string, CachedMessageRecord<T>>; syncedAt: number }
  staged: { records: Record<string, CachedMessageRecord<T>> }
  local: { messages: T[]; acceptedMisses?: Record<string, number> }
}

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
  return { ...cache, staged: { records: { ...cache.staged.records, [id]: { message, fingerprint: actual } } } }
}

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
      const messages = cache.local.messages.flatMap((message) => {
        const localInfo = message.info as { id: string; delivery?: string; legacyPrompt?: boolean }
        const localText = (message as { parts?: Array<{ type?: string; text?: string }> }).parts?.find((part) => part.type === "text")?.text
        const canonicalLegacyMatch = localInfo.legacyPrompt && localText && Object.values(records).some((record) => {
          const candidate = record.message as { info?: { role?: string }; parts?: Array<{ type?: string; text?: string }> }
          return candidate.info?.role === "user" && candidate.parts?.some((part) => part.type === "text" && part.text === localText)
        })
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
  let staged = cache
  const manifest = [] as Array<{ id: string; fingerprint: string }>
  for (const message of messages) {
    staged = await stageMessage(staged, message)
    const record = staged.staged.records[message.info.id]
    if (!record || manifest.some((entry) => entry.id === message.info.id)) throw new Error("Legacy messages require unique ids")
    manifest.push({ id: message.info.id, fingerprint: record.fingerprint })
  }
  const snapshotId = await canonicalJsonFingerprint({ version: 1, scope: { kind: "tail", limit: 80 }, manifest })
  const committed = commitMessageManifest(staged, { version: 1, scope: { kind: "tail", limit: 80 }, manifest, upserts: manifest.map((entry) => entry.id), chunkCount: 1, snapshotId })
  if (!committed) throw new Error("Could not construct canonical message cache")
  return committed
}

export const visibleCachedMessages = <T extends MessageWithId>(cache: MessageCache<T>) => {
  const canonical = cache.canonical.manifest.flatMap((entry) => {
    const record = cache.canonical.records[entry.id]
    return record ? [record.message] : []
  })
  const canonicalIds = new Set(canonical.map((message) => message.info.id))
  const staged = Object.values(cache.staged.records).map((record) => record.message).filter((message) => !canonicalIds.has(message.info.id))
  return [...canonical, ...staged, ...cache.local.messages.filter((message) => !canonicalIds.has(message.info.id))]
}
