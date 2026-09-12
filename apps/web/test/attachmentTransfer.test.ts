import { describe, expect, it } from "vitest"
import { decodeImageBase64, imageDigest, IMAGE_CHUNK_BYTES } from "@remotty/protocol"
import { AttachmentAssembly } from "../src/features/relay/attachmentTransfer"
import { commandForRelayCapabilities } from "../src/features/relay/relayModel"

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII="
const address = { sessionId: "s", messageId: "m", attachmentId: "f" }
async function manifest(bytes = decodeImageBase64(png)) {
  return { ...address, descriptor: { storage: "remotty-attachment-v1" as const, id: "f", mime: "image/png" as const, byteLength: bytes.length, digest: await imageDigest(bytes) }, total: Math.ceil(bytes.length / IMAGE_CHUNK_BYTES) }
}
describe("attachment transfer", () => {
  it("reassembles only a matching manifest and validated digest", async () => {
    const assembly = new AttachmentAssembly(address)
    assembly.start(await manifest())
    expect((await assembly.add({ index: 0, bytes: png }))?.bytes).toEqual(decodeImageBase64(png))
  })
  it("rejects unexpected, duplicate, and out-of-order chunks", async () => {
    await expect(new AttachmentAssembly(address).add({ index: 0, bytes: png })).rejects.toThrow()
    const bytes = new Uint8Array(IMAGE_CHUNK_BYTES + 1)
    bytes.set(decodeImageBase64(png))
    const first = Buffer.from(bytes.subarray(0, IMAGE_CHUNK_BYTES)).toString("base64")
    for (const next of [{ index: 0, bytes: first }, { index: 2, bytes: "AA==" }]) {
      const assembly = new AttachmentAssembly(address)
      assembly.start(await manifest(bytes))
      await assembly.add({ index: 0, bytes: first })
      await expect(assembly.add(next)).rejects.toThrow()
    }
  })
  it("rejects digest, declared size, and reference conflicts", async () => {
    const original = await manifest()
    for (const altered of [{ ...original, sessionId: "other" }, { ...original, messageId: "other" }, { ...original, attachmentId: "other" }, { ...original, total: 2 }]) expect(() => new AttachmentAssembly(address).start(altered)).toThrow()
    for (const descriptor of [{ ...original.descriptor, digest: "0".repeat(64) }, { ...original.descriptor, byteLength: 1 }]) {
      const assembly = new AttachmentAssembly(address)
      assembly.start({ ...original, descriptor })
      await expect(assembly.add({ index: 0, bytes: png })).rejects.toThrow()
    }
    const assembly = new AttachmentAssembly(address)
    assembly.start(original)
    expect(() => assembly.start(original)).toThrow()
  })
  it("gates references and retrieval on the advertised capability", () => {
    const command = { type: "session.messages" as const, sessionId: "s", attachments: "references-v1" as const }
    expect(commandForRelayCapabilities(command)).not.toHaveProperty("attachments")
    expect(commandForRelayCapabilities(command, { attachmentRead: 1 })).toHaveProperty("attachments", "references-v1")
    expect(() => commandForRelayCapabilities({ type: "attachment.get", ...address })).toThrow("Update")
    expect(commandForRelayCapabilities({ type: "attachment.get", ...address }, { attachmentRead: 1 }).type).toBe("attachment.get")
  })
})
