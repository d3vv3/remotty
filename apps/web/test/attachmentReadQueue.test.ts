import { describe, expect, it, vi } from "vitest"
import { AttachmentReadQueue } from "../src/features/attachments/attachmentReadQueue"

describe("browser image read queue", () => {
  it("never delivers to a cancelled sole active consumer and starts the next read only after completion", async () => {
    const queue = new AttachmentReadQueue<number>()
    let release!: (value: number) => void
    const controller = new AbortController()
    const delivered = vi.fn()
    const first = queue.read("first", () => new Promise<number>((resolve) => { release = resolve }), controller.signal)
    const observed = first.then(delivered)
    const nextRead = vi.fn(async () => 7)
    const next = queue.read("next", nextRead)
    await Promise.resolve()
    controller.abort()
    await expect(observed).rejects.toThrow("cancelled")
    expect(nextRead).not.toHaveBeenCalled()
    release(42)
    expect(await next).toBe(7)
    expect(nextRead).toHaveBeenCalledOnce()
    expect(delivered).not.toHaveBeenCalled()
  })
  it("deduplicates reads and cancelling one consumer preserves the other", async () => {
    const queue = new AttachmentReadQueue<number>()
    let release!: (value: number) => void
    const read = vi.fn(() => new Promise<number>((resolve) => { release = resolve }))
    const controller = new AbortController()
    const first = queue.read("identity/workspace/session/message/attachment/digest", read, controller.signal)
    const second = queue.read("identity/workspace/session/message/attachment/digest", read)
    controller.abort()
    await expect(first).rejects.toThrow("cancelled")
    release(42)
    expect(await second).toBe(42)
    expect(read).toHaveBeenCalledOnce()
  })
  it("bounds the metadata queue and removes unmounted queued reads", async () => {
    const queue = new AttachmentReadQueue<number>()
    let release!: (value: number) => void
    const first = queue.read("first", () => new Promise<number>((resolve) => { release = resolve }))
    const controller = new AbortController()
    const read = vi.fn(async () => 1)
    const queued = Array.from({ length: 32 }, (_, index) => queue.read(String(index), read, controller.signal))
    const rejected = queued.map((promise) => expect(promise).rejects.toThrow("cancelled"))
    await expect(queue.read("overflow", read)).rejects.toThrow("busy")
    expect(read).not.toHaveBeenCalled()
    controller.abort()
    await Promise.all(rejected)
    const replacement = queue.read("replacement", read)
    release(0)
    expect(await first).toBe(0)
    expect(await replacement).toBe(1)
    expect(read).toHaveBeenCalledOnce()
  })
})
