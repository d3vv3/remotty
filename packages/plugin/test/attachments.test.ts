import { describe, expect, it, vi } from "vitest"
import { attachmentChunks, attachmentReferences, resolveAttachment } from "../src/attachments"
import { messageDeltaPlan } from "../src/messageSync"
import { generateEncryptionKeyPair, generateSigningKeyPair, sealJsonPayload, IMAGE_CHUNK_BYTES } from "@remotty/protocol"

const address = { sessionId: "s", messageId: "m", attachmentId: "f" }
const url = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII="
const file = { type: "file", id: "f", sessionID: "s", messageID: "m", mime: "image/png", url, filename: "result.png" }
const message = { info: { id: "m", sessionID: "s", role: "assistant" }, parts: [file] }
describe("authoritative attachment retrieval", () => {
  it("finishes each descriptor before cloning and decoding the next message", async () => {
    const originalDigest = crypto.subtle.digest.bind(crypto.subtle)
    let release!: () => void
    const digest = vi.spyOn(crypto.subtle, "digest").mockImplementationOnce((algorithm, data) => new Promise<ArrayBuffer>((resolve) => {
      release = () => { void originalDigest(algorithm, data).then(resolve) }
    }))
    const clone = vi.spyOn(globalThis, "structuredClone")
    try {
      const pending = attachmentReferences([message, message])
      expect(clone).toHaveBeenCalledTimes(1)
      release()
      expect(await pending).toHaveLength(2)
      expect(clone).toHaveBeenCalledTimes(2)
    } finally { digest.mockRestore(); clone.mockRestore() }
  })
  it("resolves a top-level file and a completed tool attachment", async () => {
    expect((await resolveAttachment(message, address)).descriptor).toMatchObject({ id: "f", byteLength: 68, mime: "image/png" })
    const tool = { ...message, parts: [{ type: "tool", state: { status: "completed", attachments: [file] } }] }
    expect((await resolveAttachment(tool, address)).bytes.length).toBe(68)
    await expect(resolveAttachment({ ...tool, parts: [{ type: "tool", state: { status: "running", attachments: [file] } }] }, address)).rejects.toThrow()
  })
  it("checks exact message and file ownership and unique IDs", async () => {
    for (const value of [
      { ...message, info: { id: "other", sessionID: "s" } },
      { ...message, info: { id: "m", sessionID: "other" } },
      { ...message, parts: [{ ...file, sessionID: "other" }] },
      { ...message, parts: [{ ...file, messageID: "other" }] },
      { ...message, parts: [{ ...file, id: "other" }] },
      { ...message, parts: [file, file] },
      { ...message, parts: [file, { type: "tool", state: { status: "completed", attachments: [file] } }] },
    ]) await expect(resolveAttachment(value, address)).rejects.toThrow()
  })
  it.each(["file:///etc/passwd", "/tmp/image.png", "https://localhost/image.png", "https://example.com/image.png", "data:image/svg+xml;base64,PHN2Zy8+"]) ("never reads or fetches %s", async (url) => {
    await expect(resolveAttachment({ ...message, parts: [{ ...file, url }] }, address)).rejects.toThrow()
  })
  it("does not treat markdown paths as attachment records", async () => {
    await expect(resolveAttachment({ ...message, parts: [{ type: "text", id: "f", text: "![result](/tmp/result.png)" }] }, address)).rejects.toThrow()
  })
  it("keeps legacy bytes intact and fingerprints the negotiated representation consistently", async () => {
    const references = await attachmentReferences([message])
    expect(message.parts[0]!.url).toBe(url)
    expect(references[0]!.parts[0]!.url).toBe("remotty-attachment:f")
    const first = await messageDeltaPlan(references, [])
    expect((await messageDeltaPlan(await attachmentReferences([message]), first.manifest.manifest)).manifest.chunkCount).toBe(0)
    expect((await messageDeltaPlan([message], first.manifest.manifest)).manifest.upserts).toEqual(["m"])
  })
  it("keeps a full encrypted chunk below the broker frame ceiling", async () => {
    const [sender, recipient, signing] = await Promise.all([generateEncryptionKeyPair(), generateEncryptionKeyPair(), generateSigningKeyPair()])
    const chunk = attachmentChunks(new Uint8Array(IMAGE_CHUNK_BYTES)).next().value!
    expect(chunk.bytes.length).toBe(48 * 1024)
    const frame = await sealJsonPayload({ type: "attachment.chunk", requestId: "r".repeat(200), chunk }, { channel: "data", messageId: "frame", issuedAt: 1, sender: "relay", recipient: "device", senderEncryptionPrivateKey: sender.privateKey, recipientEncryptionPublicKey: recipient.publicKey, senderSigningPrivateKey: signing.privateKey })
    expect(Buffer.byteLength(JSON.stringify(frame))).toBeLessThan(128 * 1024)
  })
})
