import { MAX_CANONICAL_MESSAGE_BYTES } from "@remotty/protocol"

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
