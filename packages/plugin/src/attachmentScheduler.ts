const busy = () => new Error("Image transfer busy. Try again.")
const closed = () => new Error("Image transfer connection closed")
export const attachmentDelay = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) { reject(closed()); return }
  const abort = () => { clearTimeout(timer); reject(closed()) }
  const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve() }, ms)
  signal.addEventListener("abort", abort, { once: true })
})

/** One decoding job and one metadata-only waiter, shared by all recipients. */
export class AttachmentScheduler {
  private active = false
  private waiting?: { start: () => void; cancel: () => void }
  private lastFrame = -Infinity
  run(job: () => Promise<void>, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(closed())
    if (this.active && this.waiting) return Promise.reject(busy())
    return new Promise((resolve, reject) => {
      const cancel = () => { if (this.waiting?.cancel === cancel) this.waiting = undefined; reject(closed()) }
      const start = () => {
        signal.removeEventListener("abort", cancel)
        this.active = true
        void Promise.resolve().then(() => { signal.throwIfAborted(); return job() }).then(resolve, reject).finally(() => {
          this.active = false
          const next = this.waiting
          this.waiting = undefined
          next?.start()
        })
      }
      if (!this.active) start()
      else { this.waiting = { start, cancel }; signal.addEventListener("abort", cancel, { once: true }) }
    })
  }
  async frame(socket: { readyState: number; bufferedAmount: number }, signal: AbortSignal, send: () => Promise<void>) {
    const deadline = Date.now() + 2000
    while (true) {
      signal.throwIfAborted()
      if (socket.readyState !== 1) throw closed()
      const remaining = this.lastFrame + 50 - Date.now()
      if (socket.bufferedAmount <= 128 * 1024 && remaining <= 0) break
      if (Date.now() >= deadline) throw new Error("Image transfer backpressure timed out")
      await attachmentDelay(Math.max(1, Math.min(50, remaining > 0 ? remaining : 50)), signal)
    }
    await send()
    this.lastFrame = Date.now()
  }
}
