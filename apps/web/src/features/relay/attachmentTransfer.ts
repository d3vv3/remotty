import { attachmentManifestSchema, attachmentChunkSchema, decodeImageBase64, IMAGE_CHUNK_BYTES, imageDigest, validateImage, type AttachmentAddress, type AttachmentDescriptor } from "@remotty/protocol"

export class AttachmentAssembly {
  private manifest?: ReturnType<typeof attachmentManifestSchema.parse>
  private bytes?: Uint8Array<ArrayBuffer>
  private nextIndex = 0
  private size = 0
  private failed = false
  constructor(private readonly address: AttachmentAddress) {}
  start(value: unknown) {
    if (this.manifest || this.failed) throw new Error("Duplicate attachment manifest")
    const manifest = attachmentManifestSchema.parse(value)
    if (manifest.sessionId !== this.address.sessionId || manifest.messageId !== this.address.messageId || manifest.attachmentId !== this.address.attachmentId) throw new Error("Attachment reference mismatch")
    this.manifest = manifest
    this.bytes = new Uint8Array(manifest.descriptor.byteLength)
  }
  async add(value: unknown): Promise<{ bytes: Uint8Array<ArrayBuffer>; descriptor: AttachmentDescriptor } | undefined> {
    try {
      const chunk = attachmentChunkSchema.parse(value)
      const manifest = this.manifest
      if (this.failed || !manifest || !this.bytes || chunk.index !== this.nextIndex || chunk.index >= manifest.total) throw new Error("Unexpected attachment chunk")
      const bytes = decodeImageBase64(chunk.bytes, IMAGE_CHUNK_BYTES)
      const expected = Math.min(IMAGE_CHUNK_BYTES, manifest.descriptor.byteLength - this.size)
      if (bytes.length !== expected) throw new Error("Attachment chunk size mismatch")
      this.bytes.set(bytes, this.size)
      this.size += bytes.length
      if (++this.nextIndex !== manifest.total) return
      const combined = this.bytes
      if (await imageDigest(combined) !== manifest.descriptor.digest) throw new Error("Attachment digest mismatch")
      validateImage(combined, manifest.descriptor.mime)
      return { bytes: combined, descriptor: manifest.descriptor }
    } catch (error) { this.failed = true; this.bytes = undefined; throw error }
  }
}
