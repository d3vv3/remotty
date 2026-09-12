import { afterEach, describe, expect, it, vi } from "vitest"
import { AttachmentScheduler } from "../src/attachmentScheduler"
import { attachmentChunks } from "../src/attachments"
import { IMAGE_CHUNK_BYTES } from "@remotty/protocol"

afterEach(() => vi.useRealTimers())
describe("attachment scheduler", () => {
  it("resolves only one job, keeps one waiter, and explicitly rejects excess", async () => {
    const scheduler = new AttachmentScheduler()
    const signal = new AbortController().signal
    let release!: () => void
    const first = scheduler.run(() => new Promise<void>((resolve) => { release = resolve }), signal)
    const secondJob = vi.fn(async () => {})
    const second = scheduler.run(secondJob, signal)
    await expect(scheduler.run(async () => {}, signal)).rejects.toThrow("Image transfer busy. Try again.")
    expect(secondJob).not.toHaveBeenCalled()
    release()
    await Promise.all([first, second])
    expect(secondJob).toHaveBeenCalledOnce()
  })
  it("drops disconnected queued jobs before resolving any bytes", async () => {
    const scheduler = new AttachmentScheduler()
    const controller = new AbortController()
    let release!: () => void
    const first = scheduler.run(() => new Promise<void>((resolve) => { release = resolve }), new AbortController().signal)
    const job = vi.fn(async () => {})
    const queued = scheduler.run(job, controller.signal)
    controller.abort()
    await expect(queued).rejects.toThrow("closed")
    release()
    await first
    expect(job).not.toHaveBeenCalled()
  })
  it("spaces all frames at least 50ms and bounds backpressure waits", async () => {
    vi.useFakeTimers()
    const scheduler = new AttachmentScheduler()
    const controller = new AbortController()
    const socket = { readyState: 1, bufferedAmount: 0 }
    const times: number[] = []
    const send = async () => { times.push(Date.now()) }
    await scheduler.frame(socket, controller.signal, send)
    const second = scheduler.frame(socket, controller.signal, send)
    await vi.advanceTimersByTimeAsync(49)
    expect(times).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    await second
    expect(times[1]! - times[0]!).toBe(50)
    socket.bufferedAmount = 1024 * 1024
    const blocked = scheduler.frame(socket, controller.signal, send)
    const rejection = expect(blocked).rejects.toThrow("backpressure timed out")
    await vi.advanceTimersByTimeAsync(2000)
    await rejection
    const cancelled = scheduler.frame(socket, controller.signal, send)
    controller.abort()
    await expect(cancelled).rejects.toThrow("closed")
    expect(vi.getTimerCount()).toBe(0)
  })
  it("encodes only the requested chunk, lazily", () => {
    const bytes = new Uint8Array(IMAGE_CHUNK_BYTES * 2)
    const chunks = attachmentChunks(bytes)
    expect(chunks.next().value?.index).toBe(0)
    bytes[IMAGE_CHUNK_BYTES] = 42
    const next = chunks.next().value!
    expect(Buffer.from(next.bytes, "base64")[0]).toBe(42)
    expect(chunks.next().done).toBe(true)
  })
})
