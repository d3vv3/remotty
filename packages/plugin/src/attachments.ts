import { attachmentAddressSchema, decodeImageDataUrl, imageDigest, IMAGE_CHUNK_BYTES, type AttachmentAddress, type AttachmentDescriptor } from "@remotty/protocol"

type ObjectValue = Record<string, unknown>
const object = (value: unknown): ObjectValue | undefined => value !== null && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : undefined
function files(message: ObjectValue) {
  const result: ObjectValue[] = []
  if (!Array.isArray(message.parts)) return result
  for (const value of message.parts) {
    const part = object(value)
    if (part?.type === "file") result.push(part)
    const state = object(part?.state)
    if (part?.type === "tool" && state?.status === "completed" && Array.isArray(state.attachments)) {
      for (const attachment of state.attachments) {
        const file = object(attachment)
        if (file?.type === "file") result.push(file)
      }
    }
  }
  return result
}
export async function resolveAttachment(messageValue: unknown, addressValue: AttachmentAddress) {
  const address = attachmentAddressSchema.parse(addressValue)
  const message = object(messageValue)
  const info = object(message?.info)
  if (!message || info?.id !== address.messageId || info.sessionID !== address.sessionId) throw new Error("Attachment message ownership mismatch")
  const matches = files(message).filter((part) => part.id === address.attachmentId)
  if (matches.length !== 1) throw new Error("Attachment missing or ambiguous")
  const file = matches[0]!
  if (file.sessionID !== address.sessionId || file.messageID !== address.messageId || typeof file.url !== "string" || typeof file.mime !== "string") throw new Error("Attachment ownership mismatch")
  const image = decodeImageDataUrl(file.url, file.mime)
  const descriptor: AttachmentDescriptor = {
    storage: "remotty-attachment-v1", id: address.attachmentId, mime: image.mime,
    ...(typeof file.filename === "string" ? { filename: file.filename.slice(0, 1024) } : {}),
    byteLength: image.bytes.length, digest: await imageDigest(image.bytes),
  }
  return { ...image, descriptor }
}
/** Only operates on actual SDK file parts; never interprets paths or downloads URLs. */
export async function attachmentReferences<T>(messages: T[]): Promise<T[]> {
  const result: T[] = []
  for (const original of messages) {
    const message = structuredClone(original)
    const record = object(message)
    const info = object(record?.info)
    if (!record || typeof info?.id !== "string" || typeof info.sessionID !== "string") { result.push(message); continue }
    const replacements: { file: ObjectValue; descriptor: AttachmentDescriptor }[] = []
    for (const file of files(record)) {
      if (typeof file.id !== "string" || typeof file.url !== "string" || !file.url.startsWith("data:image/")) continue
      try {
        const { descriptor } = await resolveAttachment(record, { sessionId: info.sessionID, messageId: info.id, attachmentId: file.id })
        replacements.push({ file, descriptor })
      } catch { /* Unsupported content retains the legacy blocked-preview representation. */ }
    }
    for (const { file, descriptor } of replacements) {
      file.url = `remotty-attachment:${descriptor.id}`
      file.attachment = descriptor
    }
    result.push(message)
  }
  return result
}
export function* attachmentChunks(bytes: Uint8Array) {
  for (let offset = 0; offset < bytes.length; offset += IMAGE_CHUNK_BYTES) yield { index: offset / IMAGE_CHUNK_BYTES, bytes: Buffer.from(bytes.subarray(offset, offset + IMAGE_CHUNK_BYTES)).toString("base64") }
}
