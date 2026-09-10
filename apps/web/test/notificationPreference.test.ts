import { readFile } from "node:fs/promises"
import { afterEach, describe, expect, it, vi } from "vitest"
import { persistNotificationPreference } from "../src/features/notifications/notificationPreference"

afterEach(() => vi.unstubAllGlobals())

describe("notification preference persistence", () => {
  it("writes and removes only the notification preference", () => {
    const storage = { setItem: vi.fn(), removeItem: vi.fn() }
    vi.stubGlobal("localStorage", storage)
    persistNotificationPreference(true)
    expect(storage.setItem).toHaveBeenCalledExactlyOnceWith("remotty-notifications", "enabled")
    expect(storage.removeItem).not.toHaveBeenCalled()
    persistNotificationPreference(false)
    expect(storage.removeItem).toHaveBeenCalledExactlyOnceWith("remotty-notifications")
  })

  it.each([true, false])("continues when storage is absent (enabled=%s)", (enabled) => {
    vi.stubGlobal("localStorage", undefined)
    expect(() => persistNotificationPreference(enabled)).not.toThrow()
  })

  it.each([true, false])("continues when accessing storage throws (enabled=%s)", (enabled) => {
    vi.stubGlobal("localStorage", undefined)
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() { throw new DOMException("Storage blocked", "SecurityError") },
    })
    expect(() => persistNotificationPreference(enabled)).not.toThrow()
  })

  it.each(["SecurityError", "QuotaExceededError"])("continues when storage operations throw %s", (name) => {
    const fail = vi.fn(() => { throw new DOMException("Storage unavailable", name) })
    vi.stubGlobal("localStorage", { setItem: fail, removeItem: fail })
    expect(() => persistNotificationPreference(true)).not.toThrow()
    expect(() => persistNotificationPreference(false)).not.toThrow()
    expect(fail).toHaveBeenCalledTimes(2)
  })

  it("uses safe preference writes without changing Push cleanup or UI update order", async () => {
    const source = await readFile(new URL("../src/features/relay/hooks/useRelay.ts", import.meta.url), "utf8")
    const disconnect = source.slice(source.indexOf("const disconnect ="), source.indexOf("const request ="))
    expect(disconnect).toContain(`persistNotificationPreference(false)
    cleanupRef.current = (async () => {
      if (identity) await unregisterPush(identity)
      if (identity) await deleteIdentity(identity)`)
    const toggle = source.slice(source.indexOf("const toggleNotifications ="), source.indexOf("const isRelayConnected ="))
    expect(toggle).toContain(`await unregisterPush(identity)
        persistNotificationPreference(false)
        setNotificationsEnabled(false)`)
    expect(toggle).toContain(`await registerPush(identity)
      persistNotificationPreference(true)
      setNotificationsEnabled(true)`)
    expect(disconnect + toggle).not.toMatch(/localStorage\.(setItem|removeItem)/)
    expect(toggle).toContain(`} catch (cause) {
      setError((cause as Error).message)`)
  })
})
