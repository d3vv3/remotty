/** @vitest-environment jsdom */
import { act, StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"
import { createLocalPreference } from "../src/infrastructure/preferences/localPreference"
import { usePreference } from "../src/hooks/usePreference"

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const key = "test-preference"
const create = () => createLocalPreference<readonly string[]>({
  key, defaultValue: [], parse: raw => JSON.parse(raw ?? "[]"), serialize: JSON.stringify,
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear() })

it("caches parsed arrays by raw value and never writes on reads or subscription", () => {
  localStorage.setItem(key, '["one"]')
  const set = vi.spyOn(Storage.prototype, "setItem")
  const preference = create()
  const first = preference.getSnapshot()
  expect(first).toEqual(["one"])
  expect(preference.getSnapshot()).toBe(first)
  const unsubscribe = preference.subscribe(() => {})
  window.dispatchEvent(new StorageEvent("storage", { key }))
  expect(preference.getSnapshot()).toBe(first)
  expect(set).not.toHaveBeenCalled()
  unsubscribe()
})

it("rereads actual cross-tab values, ignores other keys, and handles clear", () => {
  const preference = create()
  const listener = vi.fn()
  const unsubscribe = preference.subscribe(listener)
  localStorage.setItem(key, '["new"]')
  window.dispatchEvent(new StorageEvent("storage", { key: "unrelated" }))
  expect(listener).not.toHaveBeenCalled()
  expect(preference.getSnapshot()).toEqual([])
  window.dispatchEvent(new StorageEvent("storage", { key, newValue: '["obsolete"]' }))
  expect(preference.getSnapshot()).toEqual(["new"])
  localStorage.clear()
  window.dispatchEvent(new StorageEvent("storage", { key: null, newValue: "ignored" }))
  expect(preference.getSnapshot()).toEqual([])
  expect(listener).toHaveBeenCalledTimes(2)
  unsubscribe()
})

it.each(["getItem", "setItem"] as const)("retains memory after failed %s, including remount and storage events", method => {
  localStorage.setItem(key, '["old"]')
  const failure = vi.spyOn(Storage.prototype, method).mockImplementation(() => { throw Error("blocked") })
  const preference = create()
  const unsubscribe = preference.subscribe(() => {})
  preference.set(["chosen"])
  failure.mockRestore()
  window.dispatchEvent(new StorageEvent("storage", { key }))
  expect(preference.getSnapshot()).toEqual(["chosen"])
  unsubscribe()
  const remount = preference.subscribe(() => {})
  expect(preference.getSnapshot()).toEqual(["chosen"])
  remount()
})

it("refreshes a cached store after an external change while unmounted", () => {
  const preference = create()
  const unsubscribe = preference.subscribe(() => {})
  preference.set(["old"])
  unsubscribe()
  localStorage.setItem(key, '["new"]')
  const remount = preference.subscribe(() => {})
  expect(preference.getSnapshot()).toEqual(["new"])
  remount()
})

it("shares updates between StrictMode consumers and cleans up its one storage listener", async () => {
  const add = vi.spyOn(window, "addEventListener")
  const remove = vi.spyOn(window, "removeEventListener")
  const preference = create()
  function Control() {
    const [value] = usePreference(preference)
    return <button onClick={() => preference.update(current => [...current, "one"])}>{value.join(",")}</button>
  }
  const container = document.createElement("div")
  const root = createRoot(container)
  try {
    await act(async () => root.render(<StrictMode><Control /><Control /></StrictMode>))
    await act(async () => container.querySelector("button")!.click())
    expect([...container.querySelectorAll("button")].map(button => button.textContent)).toEqual(["one", "one"])
    expect(add.mock.calls.filter(([type]) => type === "storage").length - remove.mock.calls.filter(([type]) => type === "storage").length).toBe(1)
  } finally { await act(async () => root.unmount()) }
  expect(remove.mock.calls.filter(([type]) => type === "storage")).toEqual(add.mock.calls.filter(([type]) => type === "storage"))
})

it("imports and creates lazily without window and supplies a stable server default", async () => {
  vi.resetModules()
  vi.stubGlobal("window", undefined)
  const { createLocalPreference: factory } = await import("../src/infrastructure/preferences/localPreference")
  const parse = vi.fn()
  const defaultValue: readonly string[] = []
  const preference = factory({ key, defaultValue, parse, serialize: JSON.stringify })
  expect(preference.getServerSnapshot()).toBe(defaultValue)
  expect(preference.getSnapshot()).toBe(defaultValue)
  expect(parse).not.toHaveBeenCalled()
})

it("supports explicit removal and falls back on malformed input without repairing storage", () => {
  localStorage.setItem(key, "{")
  const preference = create()
  expect(preference.getSnapshot()).toEqual([])
  expect(localStorage.getItem(key)).toBe("{")
  const removable = createLocalPreference({ key, defaultValue: true, parse: raw => raw !== "false", serialize: () => null })
  removable.set(true)
  expect(localStorage.getItem(key)).toBeNull()
})
