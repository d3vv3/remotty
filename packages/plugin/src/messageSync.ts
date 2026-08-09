import { canonicalJsonFingerprint, canonicalMessageValue, MAX_CANONICAL_MESSAGE_BYTES, type JsonValue, type MessageDeltaChunk, type MessageDeltaManifest } from "@remotty/protocol"

export const MESSAGE_CHUNK_BYTES = 48 * 1024
export const MAX_MESSAGE_CHUNKS = 4_096

type MessageLike = { info?: { id?: string } }
export type MessageChunk<T> = T[] | { fragment: { messageId: string; index: number; total: number; bytes: string } }
export type MessagePlan<T> = { ids: string[]; chunks: MessageChunk<T>[] }
export type DeltaPlan<T> = { manifest: MessageDeltaManifest; chunks: MessageDeltaChunk[] }

const encodedSize = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength

export const orderedMessages = <T extends MessageLike>(messages: T[]) => [...messages]

const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64")

export const messageChunks = <T extends MessageLike>(messages: T[], maxBytes = MESSAGE_CHUNK_BYTES): MessageChunk<T>[] => {
  const chunks: MessageChunk<T>[] = []
  let chunk: T[] = []
  let size = 2
  for (const message of orderedMessages(messages)) {
    const messageSize = encodedSize(message)
    if (messageSize > MAX_CANONICAL_MESSAGE_BYTES) throw new Error("Message exceeds the canonical message size limit")
    if (messageSize > maxBytes) {
      if (!message.info?.id) throw new Error("Cannot chunk a message without a stable id")
      if (chunk.length) chunks.push(chunk)
      chunk = []
      size = 2
      const bytes = new TextEncoder().encode(JSON.stringify(message))
      const fragmentBytes = Math.max(1, Math.floor((maxBytes - 1_024) * 0.7))
      const total = Math.ceil(bytes.length / fragmentBytes)
      if (total > MAX_MESSAGE_CHUNKS) throw new Error("Message exceeds the chunk limit")
      for (let index = 0; index < total; index += 1) {
        chunks.push({ fragment: { messageId: message.info.id, index, total, bytes: base64(bytes.slice(index * fragmentBytes, (index + 1) * fragmentBytes)) } })
      }
      continue
    }
    if (chunk.length && size + messageSize > maxBytes) {
      chunks.push(chunk)
      chunk = []
      size = 2
    }
    chunk.push(message)
    size += messageSize + 1
  }
  if (chunk.length || !chunks.length) chunks.push(chunk)
  if (chunks.length > MAX_MESSAGE_CHUNKS) throw new Error("Message response exceeds the chunk limit")
  return chunks
}

export const messagePlan = <T extends MessageLike & { info?: { id?: string; role?: string }; parts?: Array<{ type?: string; text?: string }> }>(messages: T[], maxBytes = MESSAGE_CHUNK_BYTES): MessagePlan<T> => {
  const ids = messages.map((message) => message.info?.id)
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length || ids.length > 80) throw new Error("Messages require unique stable ids")
  const units = messages.map((message, index) => ({ index, chunks: messageChunks([message], maxBytes) }))
  units.sort((left, right) => right.index - left.index)
  return { ids: ids as string[], chunks: units.flatMap((unit) => unit.chunks) }
}

const asJson = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue

export const deltaSnapshotId = (manifest: MessageDeltaManifest["manifest"]) =>
  canonicalJsonFingerprint({ version: 1, scope: { kind: "tail", limit: 80 }, manifest })

export const messageDeltaPlan = async <T extends MessageLike & { info?: { id?: string; role?: string }; parts?: Array<{ type?: string; text?: string }> }>(
  messages: T[], known: Array<{ id: string; fingerprint: string }>, maxBytes = MESSAGE_CHUNK_BYTES,
): Promise<DeltaPlan<T>> => {
  const ids = messages.map((message) => message.info?.id)
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length || ids.length > 80) throw new Error("Messages require unique stable ids")
  const records = await Promise.all(messages.map(async (message) => ({ id: message.info!.id!, fingerprint: await canonicalJsonFingerprint(canonicalMessageValue(asJson(message))), message })))
  const knownById = new Map(known.map((entry) => [entry.id, entry.fingerprint]))
  const upsertRecords = records.filter((record) => knownById.get(record.id) !== record.fingerprint)
  const manifestEntries = records.map(({ id, fingerprint }) => ({ id, fingerprint }))
  const snapshotId = await deltaSnapshotId(manifestEntries)
  const individual = upsertRecords.map((record, index) => ({ index, record }))
  individual.sort((left, right) => right.index - left.index)
  const chunks: MessageDeltaChunk[] = []
  for (const { record } of individual) {
    const serialized = JSON.stringify(record.message)
    if (new TextEncoder().encode(serialized).byteLength > MAX_CANONICAL_MESSAGE_BYTES) throw new Error("Message exceeds the canonical message size limit")
    if (encodedSize({ records: [record], fragments: [] }) <= maxBytes) {
      chunks.push({ requestId: "", snapshotId, index: chunks.length, total: 0, records: [{ id: record.id, fingerprint: record.fingerprint, message: record.message }], fragments: [] })
      continue
    }
    const bytes = new TextEncoder().encode(serialized)
    const fragmentBytes = Math.max(1, Math.floor((maxBytes - 1_500) * 0.7))
    const total = Math.ceil(bytes.length / fragmentBytes)
    if (total > MAX_MESSAGE_CHUNKS) throw new Error("Message exceeds the chunk limit")
    for (let index = 0; index < total; index += 1) chunks.push({ requestId: "", snapshotId, index: chunks.length, total: 0, records: [], fragments: [{ messageId: record.id, fingerprint: record.fingerprint, index, total, bytes: base64(bytes.slice(index * fragmentBytes, (index + 1) * fragmentBytes)) }] })
  }
  if (chunks.length > MAX_MESSAGE_CHUNKS) throw new Error("Message response exceeds the chunk limit")
  for (const [index, chunk] of chunks.entries()) { chunk.index = index; chunk.total = chunks.length }
  return { manifest: { version: 1, scope: { kind: "tail", limit: 80 }, manifest: manifestEntries, upserts: upsertRecords.map((record) => record.id), chunkCount: chunks.length, snapshotId }, chunks }
}
