import { z } from "zod"

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const IMAGE_CHUNK_BYTES = 36 * 1024
export const imageMimeSchema = z.enum(["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"])
export type ImageMime = z.infer<typeof imageMimeSchema>
const id = z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/)
export const attachmentAddressSchema = z.object({ sessionId: id, messageId: id, attachmentId: id }).strict()
export type AttachmentAddress = z.infer<typeof attachmentAddressSchema>
export const attachmentDescriptorSchema = z.object({
  storage: z.literal("remotty-attachment-v1"), id, mime: imageMimeSchema,
  filename: z.string().max(1024).optional(), byteLength: z.number().int().positive().max(MAX_IMAGE_BYTES),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()
export type AttachmentDescriptor = z.infer<typeof attachmentDescriptorSchema>
export const attachmentManifestSchema = attachmentAddressSchema.extend({
  descriptor: attachmentDescriptorSchema, total: z.number().int().positive().max(Math.ceil(MAX_IMAGE_BYTES / IMAGE_CHUNK_BYTES)),
}).strict().superRefine((value, context) => {
  if (value.attachmentId !== value.descriptor.id || value.total !== Math.ceil(value.descriptor.byteLength / IMAGE_CHUNK_BYTES)) context.addIssue({ code: "custom", message: "Attachment manifest mismatch" })
})
export const attachmentChunkSchema = z.object({ index: z.number().int().nonnegative().max(142), bytes: z.string().min(4).max(48 * 1024) }).strict()

export function decodeImageBase64(value: string, limit = MAX_IMAGE_BYTES): Uint8Array<ArrayBuffer> {
  if (!value.length || value.length > Math.ceil(limit / 3) * 4 || value.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error("Malformed or oversized image")
  const raw = atob(value)
  if (!raw.length || raw.length > limit || btoa(raw) !== value) throw new Error("Malformed or oversized image")
  return Uint8Array.from(raw, (character) => character.charCodeAt(0))
}
export function validateImage(bytes: Uint8Array, mime: unknown): ImageMime {
  const type = imageMimeSchema.parse(mime)
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error("Image exceeds 5 MiB")
  const text = (start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length))
  const valid = type === "image/png" ? bytes.length >= 24 && bytes[0] === 137 && text(1, 7) === "PNG\r\n\x1a\n" && text(12, 4) === "IHDR"
    : type === "image/jpeg" ? bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : type === "image/gif" ? bytes.length >= 10 && ["GIF87a", "GIF89a"].includes(text(0, 6))
    : type === "image/webp" ? bytes.length >= 16 && text(0, 4) === "RIFF" && text(8, 4) === "WEBP"
    : bytes.length >= 24 && text(4, 4) === "ftyp" && ["avif", "avis"].some((brand) => text(8, 4) === brand || Array.from({ length: Math.floor((Math.min(bytes.length, 64) - 16) / 4) }, (_, index) => text(16 + index * 4, 4)).includes(brand))
  if (!valid) throw new Error("Image content does not match its MIME type")
  if (type === "image/png" || type === "image/gif") {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const width = type === "image/png" ? view.getUint32(16) : view.getUint16(6, true)
    const height = type === "image/png" ? view.getUint32(20) : view.getUint16(8, true)
    validateImageDimensions(width, height)
  } else validateRasterDimensions(bytes, type)
  return type
}
function validateRasterDimensions(bytes: Uint8Array, mime: ImageMime) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const text = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4))
  if (mime === "image/jpeg") {
    let offset = 2
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 255) break
      while (bytes[offset] === 255) offset++
      const marker = bytes[offset++]!
      if (marker === 0xda || marker === 0xd9) break
      if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue
      if (offset + 2 > bytes.length) break
      const length = view.getUint16(offset)
      if (length < 2 || offset + length > bytes.length) break
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        if (length < 8) break
        validateImageDimensions(view.getUint16(offset + 5), view.getUint16(offset + 3))
        return
      }
      offset += length
    }
  } else if (mime === "image/webp") {
    if (view.getUint32(4, true) + 8 !== bytes.length) throw new Error("Malformed WebP container")
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const kind = text(offset)
      const length = view.getUint32(offset + 4, true)
      const data = offset + 8
      if (data + length > bytes.length) break
      const uint24 = (at: number) => bytes[at]! + bytes[at + 1]! * 256 + bytes[at + 2]! * 65536
      if (kind === "VP8X" && length >= 10) {
        validateImageDimensions(uint24(data + 4) + 1, uint24(data + 7) + 1)
        return
      }
      if (kind === "VP8 " && length >= 10 && bytes[data + 3] === 0x9d && bytes[data + 4] === 0x01 && bytes[data + 5] === 0x2a) {
        validateImageDimensions(view.getUint16(data + 6, true) & 0x3fff, view.getUint16(data + 8, true) & 0x3fff)
        return
      }
      if (kind === "VP8L" && length >= 5 && bytes[data] === 0x2f) {
        const bits = view.getUint32(data + 1, true)
        validateImageDimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1)
        return
      }
      offset = data + length + (length % 2)
    }
  } else if (mime === "image/avif") {
    let dimensions = 0
    const boxes = (start: number, end: number, depth: number) => {
      if (depth > 8) throw new Error("Malformed AVIF container")
      for (let offset = start; offset + 8 <= end;) {
        const size = view.getUint32(offset)
        const kind = text(offset + 4)
        // Large-size boxes cannot be necessary for a <=5 MiB attachment.
        if (size < 8 || offset + size > end) throw new Error("Malformed AVIF container")
        if (kind === "ispe") {
          if (size < 20) throw new Error("Malformed AVIF dimensions")
          validateImageDimensions(view.getUint32(offset + 12), view.getUint32(offset + 16))
          dimensions++
        } else if (["meta", "iprp", "ipco"].includes(kind)) boxes(offset + (kind === "meta" ? 12 : 8), offset + size, depth + 1)
        offset += size
      }
    }
    boxes(0, bytes.length, 0)
    if (dimensions) return
  }
  throw new Error("Image dimensions are missing or malformed")
}
export function validateImageDimensions(width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 32768 || height > 32768 || width * height > 40_000_000) throw new Error("Image exceeds the 40 megapixel limit")
}
export function decodeImageDataUrl(url: string, expectedMime?: string) {
  if (url.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 64) throw new Error("Image exceeds 5 MiB")
  const match = /^data:(image\/(?:png|jpeg|webp|gif|avif));base64,([A-Za-z0-9+/=]+)$/.exec(url)
  if (!match || (expectedMime !== undefined && expectedMime !== match[1])) throw new Error("Unsupported image attachment")
  const bytes = decodeImageBase64(match[2]!)
  return { bytes, mime: validateImage(bytes, match[1]) }
}
export async function imageDigest(bytes: Uint8Array<ArrayBuffer>) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("")
}
