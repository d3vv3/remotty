type Consumer<T> = { resolve: (value: T) => void; reject: (reason: unknown) => void; cleanup: () => void }
type Job<T> = { key: string; run: () => Promise<T>; consumers: Set<Consumer<T>>; active: boolean }
/**
 * A single transfer plus 32 metadata-only waiters. Consumers cancel independently.
 * Cancelling the last active consumer discards its result; the bounded transfer
 * retains its slot until completion or failure before the next read starts.
 */
export class AttachmentReadQueue<T> {
  private jobs = new Map<string, Job<T>>()
  private waiting: Job<T>[] = []
  private active = false
  read(key: string, run: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(new Error("Image preview cancelled"))
    let job = this.jobs.get(key)
    if (job && job.consumers.size >= 64) return Promise.reject(new Error("Image transfer busy. Try again."))
    if (!job) {
      if (this.active && this.waiting.length >= 32) return Promise.reject(new Error("Image transfer busy. Try again."))
      job = { key, run, consumers: new Set(), active: false }
      this.jobs.set(key, job)
      this.waiting.push(job)
    }
    const target = job
    const promise = new Promise<T>((resolve, reject) => {
      const abort = () => {
        target.consumers.delete(consumer)
        consumer.cleanup()
        reject(new Error("Image preview cancelled"))
        if (!target.active && !target.consumers.size) {
          this.waiting = this.waiting.filter((entry) => entry !== target)
          this.jobs.delete(key)
        }
      }
      const consumer = { resolve, reject, cleanup: () => signal?.removeEventListener("abort", abort) }
      target.consumers.add(consumer)
      signal?.addEventListener("abort", abort, { once: true })
    })
    this.pump()
    return promise
  }
  private pump() {
    if (this.active) return
    const job = this.waiting.shift()
    if (!job) return
    this.active = job.active = true
    void Promise.resolve().then(job.run).then(
      (value) => { for (const consumer of job.consumers) consumer.resolve(value) },
      (error: unknown) => { for (const consumer of job.consumers) consumer.reject(error) },
    ).finally(() => {
      for (const consumer of job.consumers) consumer.cleanup()
      this.jobs.delete(job.key)
      this.active = false
      this.pump()
    })
  }
}
