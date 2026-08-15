import { describe, expect, it } from "vitest"
import { generateEncryptionKeyPair, generateSigningKeyPair, sealJsonPayload } from "@remotty/protocol"
import { deltaSnapshotId, messageChunks, messageDeltaPlan, messagePlan, orderedMessages } from "../src/messageSync"

describe("message sync chunks", () => {
  it("keeps canonical OpenCode order while keeping chunks bounded", () => {
    const messages = [
      { info: { id: "assistant", role: "assistant" }, parts: [{ text: "a".repeat(80) }] },
      { info: { id: "user", role: "user" }, parts: [{ text: "u".repeat(80) }] },
    ]
    expect(orderedMessages(messages)[0]?.info.id).toBe("assistant")
    expect(messageChunks(messages, 180)).toHaveLength(2)
  })

  it("fragments a single oversized message", () => {
    const chunks = messageChunks([{ info: { id: "large", role: "assistant" }, parts: [{ text: "x".repeat(500) }] }], 100)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0]).toMatchObject({ fragment: { messageId: "large", index: 0 } })
  })

  it("fragments unicode on byte boundaries and rejects unstable ids", () => {
    const chunks = messageChunks([{ info: { id: "unicode" }, text: "x".repeat(100) + "\u{1f680}".repeat(100) }], 200)
    expect(chunks.length).toBeGreaterThan(1)
    expect(() => messageChunks([{ info: {}, text: "x".repeat(500) }], 100)).toThrow("stable id")
  })

  it("keeps serialized nonfragment and fragment envelopes within the byte budget", () => {
    const maxBytes = 500
    const turns = [
      { info: { id: "one" }, parts: [{ text: "\u{1f680}".repeat(30) }] },
      { info: { id: "two" }, parts: [{ text: "x".repeat(2_000) }] },
      { info: { id: "three" }, parts: [{ text: "done" }] },
    ]
    const chunks = messageChunks(turns, maxBytes)
    expect(chunks.flatMap((chunk) => Array.isArray(chunk) ? chunk : []).map((message) => message.info.id)).toEqual(["one", "three"])
    for (const chunk of chunks) expect(Buffer.byteLength(JSON.stringify(chunk))).toBeLessThanOrEqual(maxBytes)
  })

  it("sends newest messages first with canonical manifest order", () => {
    const messages = [
      { info: { id: "tool", role: "assistant" }, parts: [{ type: "tool", text: "oldest" }] },
      { info: { id: "middle", role: "assistant" }, parts: [{ type: "text", text: "middle" }] },
      { info: { id: "user", role: "user" }, parts: [{ type: "text", text: "continue" }] },
    ]
    const plan = messagePlan(messages, 500)
    expect(plan.ids).toEqual(["tool", "middle", "user"])
    expect(plan.chunks.flatMap((chunk) => Array.isArray(chunk) ? chunk : []).map((message) => message.info.id)).toEqual(["user", "middle", "tool"])
  })

  it("uses recency rather than message role for transfer priority", () => {
    const messages = [
      { info: { id: "old-user", role: "user" }, parts: [{ type: "text", text: "old" }] },
      { info: { id: "new-tool", role: "assistant" }, parts: [{ type: "tool", text: "new" }] },
    ]
    expect(messagePlan(messages, 500).chunks[0]).toEqual([messages[1]])
  })

  it("plans stateless deltas with canonical order and newest-first transfer", async () => {
    const messages = [
      { info: { id: "tool", role: "assistant" }, parts: [{ type: "tool", text: "x".repeat(2_000) }] },
      { info: { id: "user", role: "user" }, parts: [{ type: "text", text: "continue" }] },
    ]
    const initial = await messageDeltaPlan(messages, [], 500)
    expect(initial.manifest.manifest.map((entry) => entry.id)).toEqual(["tool", "user"])
    expect(initial.chunks[0]?.records[0]?.id).toBe("user")
    const unchanged = await messageDeltaPlan(messages, initial.manifest.manifest)
    expect(unchanged.manifest.chunkCount).toBe(0)
    expect(unchanged.manifest.snapshotId).toBe(initial.manifest.snapshotId)
    const changed = await messageDeltaPlan([{ ...messages[0]!, parts: [{ type: "tool", text: "changed" }] }, messages[1]!], initial.manifest.manifest)
    expect(changed.manifest.upserts).toEqual(["tool"])
    expect(await deltaSnapshotId(initial.manifest.manifest)).toBe(initial.manifest.snapshotId)
  })

  it("packs many small changed records into bounded newest-first chunks", async () => {
    const messages = Array.from({ length: 12 }, (_, index) => ({ info: { id: `m${index}` }, parts: [{ text: "x".repeat(30) }] }))
    const plan = await messageDeltaPlan(messages, [], 1_000)
    expect(plan.chunks.length).toBeLessThan(messages.length)
    expect(plan.chunks[0]?.records.map((record) => record.id)).toContain("m11")
    for (const chunk of plan.chunks) expect(Buffer.byteLength(JSON.stringify({ type: "session.messages.chunk", chunk: { ...chunk, requestId: "r".repeat(100) } }))).toBeLessThanOrEqual(1_000)
  })

  it("seals a realistic large Unicode delta chunk well below the broker relay frame limit", async () => {
    const [senderSigning, senderEncryption, recipientEncryption] = await Promise.all([
      generateSigningKeyPair(), generateEncryptionKeyPair(), generateEncryptionKeyPair(),
    ])
    const plan = await messageDeltaPlan([
      { info: { id: "unicode-large", role: "assistant" }, parts: [{ type: "text", text: "\u{1f680}".repeat(11_000) }] },
    ], [])
    const chunk = plan.chunks[0]!
    const payload = JSON.parse(JSON.stringify({ type: "session.messages.chunk", chunk: { ...chunk, requestId: "request-1" } }))
    const frame = await sealJsonPayload(payload, {
      channel: "data", sender: "relay", recipient: "browser", messageId: "frame-1", issuedAt: 1,
      senderSigningPrivateKey: senderSigning.privateKey,
      senderEncryptionPrivateKey: senderEncryption.privateKey,
      recipientEncryptionPublicKey: recipientEncryption.publicKey,
    })
    const size = Buffer.byteLength(JSON.stringify(frame))
    expect(size).toBeLessThan(8_000_000)
    expect(size).toBeLessThan(100_000)
    expect(chunk.records.length + chunk.fragments.length).toBeGreaterThan(0)
  })
})
