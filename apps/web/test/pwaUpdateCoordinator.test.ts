import { describe, expect, it, vi } from "vitest"
import { activatePwaUpdate } from "../src/pwaUpdate"

class FakeServiceWorker {
  controller: unknown = { version: "old" }
  waiting?: { postMessage: (message: { type: "SKIP_WAITING" }) => void }
  readonly listeners = new Set<EventListener>()

  addEventListener(_type: "controllerchange", listener: EventListener) { this.listeners.add(listener) }
  removeEventListener(_type: "controllerchange", listener: EventListener) { this.listeners.delete(listener) }
  getRegistration = vi.fn(async () => ({ waiting: this.waiting }))
  changeController() {
    this.controller = { version: "new" }
    for (const listener of this.listeners) listener(new Event("controllerchange"))
  }
  dispatchControllerChange() {
    for (const listener of this.listeners) listener(new Event("controllerchange"))
  }
}

describe("PWA update activation coordinator", () => {
  it("reloads when the first activation changes controller", async () => {
    const serviceWorker = new FakeServiceWorker()
    const reload = vi.fn()
    const result = await activatePwaUpdate({
      updateServiceWorker: () => serviceWorker.changeController(),
      serviceWorker,
      reload,
      timeoutMs: 10,
    })

    expect(result).toEqual({ status: "reloading" })
    expect(reload).toHaveBeenCalledOnce()
    expect(serviceWorker.getRegistration).not.toHaveBeenCalled()
    expect(serviceWorker.listeners).toHaveLength(0)
  })

  it("posts SKIP_WAITING after the first timeout and reloads on the second activation", async () => {
    vi.useFakeTimers()
    const serviceWorker = new FakeServiceWorker()
    const postMessage = vi.fn(() => serviceWorker.changeController())
    serviceWorker.waiting = { postMessage }
    const reload = vi.fn()
    const activation = activatePwaUpdate({ updateServiceWorker: vi.fn(), serviceWorker, reload, timeoutMs: 10 })

    await vi.advanceTimersByTimeAsync(10)
    await expect(activation).resolves.toEqual({ status: "reloading" })
    expect(postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" })
    expect(reload).toHaveBeenCalledOnce()
    expect(serviceWorker.listeners).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
  })

  it("reports stalled without reloading when neither activation changes controller", async () => {
    vi.useFakeTimers()
    const serviceWorker = new FakeServiceWorker()
    serviceWorker.waiting = { postMessage: vi.fn() }
    const reload = vi.fn()
    const activation = activatePwaUpdate({ updateServiceWorker: vi.fn(), serviceWorker, reload, timeoutMs: 10 })

    await vi.advanceTimersByTimeAsync(20)
    await expect(activation).resolves.toEqual({ status: "stalled" })
    expect(reload).not.toHaveBeenCalled()
    expect(serviceWorker.listeners).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
  })

  it("continues after a hanging update helper and cleans every listener and timer", async () => {
    vi.useFakeTimers()
    const serviceWorker = new FakeServiceWorker()
    const activation = activatePwaUpdate({
      updateServiceWorker: () => new Promise<never>(() => undefined),
      serviceWorker,
      reload: vi.fn(),
      timeoutMs: 10,
    })

    await vi.advanceTimersByTimeAsync(10)
    await expect(activation).resolves.toEqual({ status: "stalled" })
    expect(serviceWorker.getRegistration).toHaveBeenCalledOnce()
    expect(serviceWorker.listeners).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
  })

  it("bounds a hanging registration lookup", async () => {
    vi.useFakeTimers()
    const serviceWorker = new FakeServiceWorker()
    serviceWorker.getRegistration = vi.fn(() => new Promise<never>(() => undefined))
    const activation = activatePwaUpdate({ updateServiceWorker: vi.fn(), serviceWorker, reload: vi.fn(), timeoutMs: 10 })

    await vi.advanceTimersByTimeAsync(20)
    await expect(activation).resolves.toEqual({ status: "stalled" })
    expect(serviceWorker.listeners).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
  })

  it("ignores a same-controller event until a real controller change occurs", async () => {
    vi.useFakeTimers()
    const serviceWorker = new FakeServiceWorker()
    serviceWorker.waiting = { postMessage: vi.fn() }
    const reload = vi.fn()
    const activation = activatePwaUpdate({ updateServiceWorker: vi.fn(), serviceWorker, reload, timeoutMs: 10 })

    serviceWorker.dispatchControllerChange()
    await vi.advanceTimersByTimeAsync(20)
    await expect(activation).resolves.toEqual({ status: "stalled" })
    expect(reload).not.toHaveBeenCalled()
    expect(serviceWorker.listeners).toHaveLength(0)
    vi.useRealTimers()
  })

  it("reloads when controller identity changes while a no-waiting registration is pending", async () => {
    vi.useFakeTimers()
    const serviceWorker = new FakeServiceWorker()
    let resolveRegistration: (value: undefined) => void = () => undefined
    serviceWorker.getRegistration = vi.fn(() => new Promise<undefined>((resolve) => { resolveRegistration = resolve }))
    const reload = vi.fn()
    const activation = activatePwaUpdate({ updateServiceWorker: vi.fn(), serviceWorker, reload, timeoutMs: 10 })

    await vi.advanceTimersByTimeAsync(10)
    serviceWorker.controller = { version: "new" }
    resolveRegistration(undefined)
    await expect(activation).resolves.toEqual({ status: "reloading" })
    expect(reload).toHaveBeenCalledOnce()
    expect(serviceWorker.listeners).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
  })

  it("returns errors and cleans up its listener without leaving timers", async () => {
    const serviceWorker = new FakeServiceWorker()
    const result = await activatePwaUpdate({
      updateServiceWorker: () => Promise.reject(new Error("worker unavailable")),
      serviceWorker,
      reload: vi.fn(),
      timeoutMs: 10,
    })

    expect(result.status).toBe("error")
    expect(serviceWorker.listeners).toHaveLength(0)
  })
})
