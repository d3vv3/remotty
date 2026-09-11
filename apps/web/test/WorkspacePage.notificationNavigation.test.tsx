/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { WorkspacePage } from "../src/pages/WorkspacePage"
import { retainedSessionState } from "../src/features/session/model/sessionState"

const mocks = vi.hoisted(() => ({ useRelay: vi.fn() }))
vi.mock("../src/features/relay", async (original) => ({ ...await original<typeof import("../src/features/relay")>(), useRelay: mocks.useRelay }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
class Worker extends EventTarget { scriptURL = `${location.origin}/sw.js` }
let workers: EventTarget
let worker: Worker
let root: ReturnType<typeof createRoot>
let container: HTMLDivElement
const session = (id: string) => ({ id, title: id, directory: "/project", status: "idle" as const, updatedAt: Date.now(), additions: 0, deletions: 0, files: 0, workspaceRelayId: "relay", workspaceId: "workspace" })
const state = () => ({
  enrolled: true, connection: "online", relay: { id: "relay", name: "Desktop" }, relays: [{ id: "relay", name: "Desktop" }],
  sessions: [session("first"), session("second")], agents: [], permissions: [], questions: [], subagentsByRoot: new Map(),
  sessionRevisions: {}, resourceRevisions: {}, notificationsEnabled: false, error: undefined, relayHealth: {}, serviceConnected: true,
  isRelayConnected: () => true, request: vi.fn(async () => []), loadCache: vi.fn(async () => undefined), saveCache: vi.fn(async () => {}),
  setError: vi.fn(), toggleNotifications: vi.fn(), disconnect: vi.fn(), connect: vi.fn(),
})
const open = async (key: string) => {
  const event = new MessageEvent("message", { origin: location.origin, data: { type: "notification.navigation.open", version: 1, sessionKey: key } })
  Object.defineProperty(event, "source", { value: worker })
  await act(async () => workers.dispatchEvent(event))
}
beforeEach(() => {
  vi.stubGlobal("ServiceWorker", Worker)
  worker = new Worker()
  workers = Object.assign(new EventTarget(), { controller: worker })
  vi.stubGlobal("navigator", { serviceWorker: workers })
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1 })
  vi.stubGlobal("cancelAnimationFrame", vi.fn())
  history.replaceState({}, "", "/app?session=workspace%3Afirst")
  retainedSessionState.clear()
  retainedSessionState.write("workspace:first", { draft: "Keep my unsent root draft", refreshed: { messages: 0, todos: 0 } })
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  retainedSessionState.clear()
  vi.unstubAllGlobals()
})

it("routes without reloading, preserves same-session DOM and restores the root draft after switching", async () => {
  mocks.useRelay.mockReturnValue(state())
  await act(async () => root.render(<WorkspacePage />))
  const prompt = container.querySelector<HTMLTextAreaElement>("textarea")!
  expect(prompt.value).toBe("Keep my unsent root draft")
  await open("workspace:first")
  expect(container.querySelector("textarea")).toBe(prompt)
  expect(prompt.value).toBe("Keep my unsent root draft")
  await open("workspace:second")
  expect(container.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("")
  await open("workspace:first")
  expect(container.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("Keep my unsent root draft")
  expect(location.pathname + location.search).toBe("/app?session=workspace%3Afirst")
})

it("retains an unknown deep-link selection until a later snapshot arrives", async () => {
  const relay = state()
  mocks.useRelay.mockReturnValue(relay)
  await act(async () => root.render(<WorkspacePage />))
  await open("workspace:later")
  expect(container.querySelector("textarea")).toBeNull()
  relay.sessions = [...relay.sessions, session("later")]
  await act(async () => root.render(<WorkspacePage />))
  expect(container.querySelector(".detail-header")?.textContent).toContain("later")
  expect(location.search).toBe("?session=workspace%3Alater")
})
