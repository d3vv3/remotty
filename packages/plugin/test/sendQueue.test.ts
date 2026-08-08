import { describe, expect, it } from "vitest"
import { PerRecipientQueue } from "../src/sendQueue"

describe("per-recipient bulk queue", () => {
  it("preserves recipient order without blocking another recipient", async () => {
    const queue = new PerRecipientQueue()
    const events: string[] = []
    let release!: () => void
    const first = queue.enqueue("a", async () => { events.push("a1"); await new Promise<void>((resolve) => { release = resolve }); events.push("a1-end") })
    const second = queue.enqueue("a", async () => { events.push("a2") })
    const other = queue.enqueue("b", async () => { events.push("b1") })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(events).toEqual(["a1", "b1"])
    release()
    await Promise.all([first, second, other])
    expect(events).toEqual(["a1", "b1", "a1-end", "a2"])
  })
})
