import { describe, expect, it } from "vitest"
import { clearSubmittedDraft, createSessionStateStore, needsMessageRefresh, resourceArray } from "../src/sessionState"
import { newlyCompletedMessages, queueProgress } from "../src/useRelay"

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

  it("serializes progress callbacks before completion can observe the chain", async () => {
    const calls: string[] = []
    const pending = { progressChain: Promise.resolve(), progress: async (messages: unknown[]) => {
      const id = (messages[0] as { info: { id: string } }).info.id
      await Promise.resolve()
      calls.push(id)
    } }
    queueProgress(pending, [{ info: { id: "first" } }])
    queueProgress(pending, [{ info: { id: "second" } }])
    await pending.progressChain
    expect(calls).toEqual(["first", "second"])
  })

  it("uses retained child messages only while their revision is fresh", () => {
    expect(needsMessageRefresh({ refreshed: { messages: 2 } }, 2)).toBe(false)
    expect(needsMessageRefresh({ refreshed: { messages: 2 } }, 3)).toBe(true)
  })

  it("reports each completed streamed message only once", () => {
    const seen = new Set<string>()
    const verified = new Set(["a", "b", "c"])
    const message = (id: string) => ({ info: { id } })
    expect(newlyCompletedMessages(seen, verified, [message("a"), message("b")]).map((item: any) => item.info.id)).toEqual(["a", "b"])
    expect(newlyCompletedMessages(seen, verified, [message("a"), message("b"), message("c")]).map((item: any) => item.info.id)).toEqual(["c"])
    expect(newlyCompletedMessages(seen, new Set(), [message("unverified")])).toEqual([])
    expect(seen.has("unverified")).toBe(false)
  })
})
