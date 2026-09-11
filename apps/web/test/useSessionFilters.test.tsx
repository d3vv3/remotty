/** @vitest-environment jsdom */
import { act, StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { renderToString } from "react-dom/server"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import type { RoutedSession } from "../src/features/relay"
let useSessionFilters: typeof import("../src/features/workspace/hooks/useSessionFilters").useSessionFilters

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const storageKey = "remotty-hidden-session-folders-v1"
const session = (directory: string, id = directory): RoutedSession => ({
  id, directory, title: id, status: "idle", updatedAt: 1,
  additions: 0, deletions: 0, files: 0, workspaceRelayId: "relay", workspaceId: "workspace",
})
let root: ReturnType<typeof createRoot>
let filters: ReturnType<typeof useSessionFilters>
function Harness({ sessions }: { sessions: RoutedSession[] }) {
  filters = useSessionFilters(sessions, new Set())
  return null
}
const render = async (sessions = [session("/one"), session("/two")], strict = false) => {
  await act(async () => root.render(strict
    ? <StrictMode><Harness sessions={sessions} /></StrictMode>
    : <Harness sessions={sessions} />))
}
const remount = async () => {
  await act(async () => root.unmount())
  root = createRoot(document.createElement("div"))
}

beforeEach(async () => {
  vi.resetModules()
  ;({ useSessionFilters } = await import("../src/features/workspace/hooks/useSessionFilters"))
  window.localStorage.clear()
  root = createRoot(document.createElement("div"))
})
afterEach(async () => {
  vi.unstubAllGlobals()
  await act(async () => root.unmount())
  vi.restoreAllMocks()
  window.localStorage.clear()
})

it("persists excluded folders across remounts and enables newly arriving folders", async () => {
  await render()
  await act(async () => filters.toggleFolder("/one"))
  expect(JSON.parse(localStorage.getItem(storageKey)!)).toEqual(["/one"])
  await remount()
  await render([session("/one"), session("/one", "another"), session("/two"), session("/new")])
  expect(filters.filteredSessions.map(item => item.directory).sort()).toEqual(["/new", "/two"])
  expect(filters.folders.find(folder => folder.directory === "/one")?.enabled).toBe(false)
  await act(async () => filters.toggleFolder("/one"))
  await remount()
  await render()
  expect(filters.folders.every(folder => folder.enabled)).toBe(true)
})

it("retains absent folder preferences through rerenders and reset persists all folders enabled", async () => {
  localStorage.setItem(storageKey, JSON.stringify(["/one", "/absent"]))
  const set = vi.spyOn(Storage.prototype, "setItem")
  await render()
  await render([])
  await render([session("/one"), session("/absent"), session("/new")])
  expect(set).not.toHaveBeenCalled()
  expect(filters.filteredSessions.map(item => item.directory)).toEqual(["/new"])
  await act(async () => filters.toggleFolder("/new"))
  expect(JSON.parse(localStorage.getItem(storageKey)!)).toEqual(["/one", "/absent", "/new"])
  await render([])
  await act(async () => filters.showAllFolders())
  expect(localStorage.getItem(storageKey)).toBe("[]")
  await remount()
  await render([session("/one"), session("/absent"), session("/new")])
  expect(filters.folders.every(folder => folder.enabled)).toBe(true)
})

it.each(["{", "null", '"/one"', '{"__proto__": ["/one"]}', '["/one", 42]', '[{}]'])(
  "ignores invalid stored data %s without overwriting it on mount", async stored => {
    localStorage.setItem(storageKey, stored)
    await render()
    expect(filters.folders.every(folder => folder.enabled)).toBe(true)
    expect(localStorage.getItem(storageKey)).toBe(stored)
  },
)

it("preserves exact path strings and safely handles prototype property names", async () => {
  const directories = ["/space here/项目", "C:\\Users\\app", "__proto__", "constructor"]
  localStorage.setItem(storageKey, JSON.stringify(directories))
  await render([...directories.map(directory => session(directory)), session("/new")])
  expect(filters.filteredSessions.map(item => item.directory)).toEqual(["/new"])
})

it("keeps updates pure and preserves loaded preferences in StrictMode", async () => {
  localStorage.setItem(storageKey, '["/one"]')
  const set = vi.spyOn(Storage.prototype, "setItem")
  await render(undefined, true)
  expect(set).not.toHaveBeenCalled()
  await act(async () => {
    filters.toggleFolder("/two")
    filters.toggleFolder("/one")
  })
  expect(filters.filteredSessions.map(item => item.directory)).toEqual(["/one"])
  expect(set.mock.calls).toEqual([[storageKey, '["/one","/two"]'], [storageKey, '["/two"]']])
})

it.each(["getItem", "setItem"] as const)("keeps filtering and reset usable when %s throws", async method => {
  vi.spyOn(Storage.prototype, method).mockImplementation(() => { throw new Error("Storage blocked") })
  await render()
  await act(async () => filters.toggleFolder("/one"))
  expect(filters.filteredSessions.map(item => item.directory)).toEqual(["/two"])
  await act(async () => filters.showAllFolders())
  expect(filters.folders.every(folder => folder.enabled)).toBe(true)
})

it("handles blocked access to localStorage itself", async () => {
  vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new Error("SecurityError") })
  await render()
  await act(async () => filters.toggleFolder("/one"))
  expect(filters.filteredSessions.map(item => item.directory)).toEqual(["/two"])
})

it("renders without a browser window", () => {
  vi.stubGlobal("window", undefined)
  expect(() => renderToString(<Harness sessions={[session("/one")]} />)).not.toThrow()
  expect(filters.folders[0]?.enabled).toBe(true)
})

it("validates cross-tab folder changes and restores defaults on storage clear", async () => {
  await render()
  await act(async () => {
    localStorage.setItem(storageKey, '["/one"]')
    window.dispatchEvent(new StorageEvent("storage", { key: storageKey, newValue: '["/two"]' }))
  })
  expect(filters.filteredSessions.map(item => item.directory)).toEqual(["/two"])
  await act(async () => {
    localStorage.setItem(storageKey, '[42]')
    window.dispatchEvent(new StorageEvent("storage", { key: storageKey }))
  })
  expect(filters.filteredSessions.map(item => item.directory)).toEqual(["/one", "/two"])
  expect(localStorage.getItem(storageKey)).toBe('[42]')
  await act(async () => filters.toggleFolder("/two"))
  await act(async () => {
    localStorage.clear()
    window.dispatchEvent(new StorageEvent("storage", { key: null }))
  })
  expect(filters.filteredSessions.map(item => item.directory)).toEqual(["/one", "/two"])
})
