/** Per-recipient FIFO queue. A slow browser cannot block bulk frames for another browser. */
export class PerRecipientQueue {
  private readonly tails = new Map<string, Promise<void>>()

  enqueue(key: string, operation: () => Promise<void>) {
    const previous = this.tails.get(key) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(operation)
    const tail = next.catch(() => undefined)
    this.tails.set(key, tail)
    void tail.finally(() => { if (this.tails.get(key) === tail) this.tails.delete(key) })
    return next
  }

  get size() { return this.tails.size }
}
