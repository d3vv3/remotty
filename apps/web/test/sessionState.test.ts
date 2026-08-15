import { describe, expect, it } from "vitest"
import { clearSubmittedDraft, createSessionStateStore, needsMessageRefresh, resourceArray } from "../src/sessionState"
import { legacyChunkState, legacyManifestCompatible, queueProgress, queueProgressSnapshot, verifiedCanonicalMessages } from "../src/useRelay"
import { addChunk, createChunkAssembly } from "../src/resilience"

describe("retained session state", () => {
  it("reuses stable keys and evicts least recently used entries", () => {
    const store = createSessionStateStore(2)
    store.write("workspace:one", { draft: "one" })
    store.write("workspace:two", { draft: "two" })
    expect(store.read("workspace:one")?.draft).toBe("one")
    store.write("workspace:three", { draft: "three" })
    expect(store.read("workspace:two")).toBeUndefined()
    expect(store.read("workspace:one")?.draft).toBe("one")
    store.clear()
    expect(store.size()).toBe(0)
  })

  it("accepts only valid resource response shapes", () => {
    expect(resourceArray([{ id: "message" }])).toEqual([{ id: "message" }])
    expect(resourceArray({ deltaManifest: {}, messages: [{ id: "message" }] })).toEqual([{ id: "message" }])
    expect(resourceArray({ messages: [] })).toBeUndefined()
    expect(resourceArray({ deltaManifest: {}, messages: "bad" })).toBeUndefined()
  })

  it("handles progress failure immediately", async () => {
    let failed = false
    const pending = { progressChain: Promise.resolve(), progress: async () => { throw new Error("progress failed") } }
    queueProgress(pending, [{}], () => { failed = true })
    await pending.progressChain.catch(() => undefined)
    await Promise.resolve()
    expect(failed).toBe(true)
  })

  it("clears only the draft that was submitted", () => {
    expect(clearSubmittedDraft("older", "older")).toBe("")
    expect(clearSubmittedDraft("newer", "older")).toBe("newer")
    expect(clearSubmittedDraft("  newer draft  ", "  older draft  ")).toBe("  newer draft  ")
  })

  it("serializes cumulative progress callbacks before completion can observe the chain", async () => {
    const calls: string[][] = []
    const pending = { progressChain: Promise.resolve(), progress: async (messages: unknown[]) => {
      await Promise.resolve()
      calls.push(messages.map((message) => (message as { info: { id: string } }).info.id))
    } }
    const snapshotPending = { ...pending, completionScheduled: false }
    queueProgressSnapshot(snapshotPending, [{ info: { id: "newest" } }], () => true)
    queueProgressSnapshot(snapshotPending, [{ info: { id: "newest" } }], () => true)
    queueProgressSnapshot(snapshotPending, [{ info: { id: "older" } }, { info: { id: "newest" } }], () => true)
    queueProgressSnapshot(snapshotPending, [{ info: { id: "older" } }, { info: { id: "newest" } }], () => true)
    queueProgressSnapshot(snapshotPending, [{ info: { id: "oldest" } }, { info: { id: "older" } }, { info: { id: "newest" } }], () => true)
    await snapshotPending.progressChain
    expect(calls).toEqual([["newest"], ["older", "newest"], ["oldest", "older", "newest"]])
  })

  it("skips inactive progress and lets an active callback stop before persistence", async () => {
    let active = false
    const calls: string[] = []
    const inactive = { progressChain: Promise.resolve(), completionScheduled: false, progress: async () => { calls.push("called") } }
    queueProgressSnapshot(inactive, [{ info: { id: "newest" } }], () => active)
    await inactive.progressChain
    expect(calls).toEqual([])

    active = true
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let staged = false
    let persisted = false
    const pending = { progressChain: Promise.resolve(), completionScheduled: false, progress: async (_messages: unknown[], isActive: () => boolean) => {
      staged = true
      await gate
      if (isActive()) persisted = true
    } }
    queueProgressSnapshot(pending, [{ info: { id: "newest" } }], () => active)
    await Promise.resolve()
    active = false
    release()
    await pending.progressChain
    expect(staged).toBe(true)
    expect(persisted).toBe(false)
  })

  it("does not queue an incomplete fragment-equivalent snapshot", async () => {
    const chunks = createChunkAssembly()
    const newest = { info: { id: "newest" } }
    expect(addChunk(chunks, { index: 0, total: 3, result: [newest] })).toBe(true)
    let calls = 0
    const pending = { progressChain: Promise.resolve(), completionScheduled: false, progress: async () => { calls += 1 } }
    const verified = new Set(["newest"])
    queueProgressSnapshot(pending, legacyChunkState(chunks, ["newest", "fragment"], verified).progress, () => true)
    expect(addChunk(chunks, { index: 1, total: 3, result: { fragment: { messageId: "fragment", index: 0, total: 2, bytes: "eA==" } } })).toBe(true)
    queueProgressSnapshot(pending, legacyChunkState(chunks, ["newest", "fragment"], verified).progress, () => true)
    await pending.progressChain
    expect(calls).toBe(1)
    expect(pending.progressSignature).toBe(JSON.stringify(["newest"]))
  })

  it("uses retained child messages only while their revision is fresh", () => {
    expect(needsMessageRefresh({ refreshed: { messages: 2 } }, 2)).toBe(false)
    expect(needsMessageRefresh({ refreshed: { messages: 2 } }, 3)).toBe(true)
  })

  it("filters cumulative verified messages in canonical order without transport ordering leaks", () => {
    const verified = new Set(["a", "b", "c"])
    const message = (id: string) => ({ info: { id } })
    const ordered = [message("a"), message("b"), message("c"), message("b"), message("unverified"), { info: { id: "" } }, { info: {} }]
    expect(verifiedCanonicalMessages(ordered, verified).map((item) => item.info.id)).toEqual(["a", "b", "c"])
    expect(verifiedCanonicalMessages([message("c"), message("a")], verified).map((item) => item.info.id)).toEqual(["c", "a"])
  })

  it("waits for a legacy manifest, then progresses and completes in canonical order", () => {
    const newest = { info: { id: "newest" } }
    const older = { info: { id: "older" } }
    const chunks = createChunkAssembly()
    expect(addChunk(chunks, { index: 0, total: 2, result: [newest] })).toBe(true)
    expect(addChunk(chunks, { index: 1, total: 2, result: [older] })).toBe(true)
    const verified = new Set(["newest", "older"])
    expect(legacyChunkState(chunks, undefined, verified)).toEqual({ progress: [], complete: false })
    expect(legacyManifestCompatible(chunks, 2)).toBe(true)
    expect(legacyChunkState(chunks, ["older", "newest"], verified)).toEqual({ progress: [older, newest], complete: true, messages: [older, newest] })
  })

  it("rejects incompatible or incomplete legacy exact sets", () => {
    const chunks = createChunkAssembly()
    expect(addChunk(chunks, { index: 0, total: 1, result: [{ info: { id: "newest" } }] })).toBe(true)
    expect(legacyManifestCompatible(chunks, 2)).toBe(false)
    expect(legacyChunkState(chunks, ["older", "newest"], new Set(["newest"]))).toEqual({ progress: [{ info: { id: "newest" } }], complete: true, messages: undefined })
  })
})
