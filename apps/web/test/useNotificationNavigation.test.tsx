/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { useNotificationNavigation } from "../src/features/notifications/hooks/useNotificationNavigation"

globalThis.IS_REACT_ACT_ENVIRONMENT = true
class Worker extends EventTarget { scriptURL = `${location.origin}/sw.js` }
let workers: EventTarget & { controller: Worker | null }
let worker: Worker
let root: ReturnType<typeof createRoot>
let container: HTMLDivElement
const select = vi.fn()
function Receiver({ enrolled }: { enrolled?: boolean }) { useNotificationNavigation(enrolled, select); return null }
const send = (data: unknown, source: unknown = worker, origin = location.origin) => {
  const port = { postMessage: vi.fn(), close: vi.fn() }
  const event = new MessageEvent("message", { data, origin })
  Object.defineProperties(event, { source: { value: source }, ports: { value: [port] } })
  workers.dispatchEvent(event)
  return port
}
const probe = { type: "notification.navigation.probe", version: 1 }
const open = { type: "notification.navigation.open", version: 1, sessionKey: "workspace:session" }

beforeEach(() => {
  vi.stubGlobal("ServiceWorker", Worker)
  worker = new Worker()
  workers = Object.assign(new EventTarget(), { controller: worker as Worker | null })
  vi.stubGlobal("navigator", { serviceWorker: workers })
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }))
  history.replaceState({}, "", "/app")
  container = document.createElement("div")
  root = createRoot(container)
  select.mockClear()
})
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals() })

it.each([undefined, false, true])("reports readiness only for enrolled=true (%s)", async (enrolled) => {
  await act(async () => root.render(<Receiver enrolled={enrolled} />))
  const port = send(probe)
  expect(port.postMessage).toHaveBeenCalledWith({ type: "notification.navigation.ready", version: 1, standalone: true, ready: enrolled === true })
  expect(port.close).toHaveBeenCalledOnce()
  send(open)
  expect(select).toHaveBeenCalledTimes(enrolled === true ? 1 : 0)
})

it("supports iOS standalone and refuses routing in browser tabs", async () => {
  vi.mocked(window.matchMedia).mockReturnValue({ matches: false } as MediaQueryList)
  await act(async () => root.render(<Receiver enrolled />))
  expect(send(probe).postMessage).toHaveBeenCalledWith(expect.objectContaining({ standalone: false }))
  send(open)
  expect(select).not.toHaveBeenCalled()
  Object.assign(navigator, { standalone: true })
  send(open)
  expect(select).toHaveBeenCalledWith("workspace:session")
  expect(location.pathname + location.search).toBe("/app?session=workspace%3Asession")
})

it("rejects window messages, foreign workers, a noncurrent controller, and unknown versions", async () => {
  await act(async () => root.render(<Receiver enrolled />))
  const foreign = new Worker(); foreign.scriptURL = "https://evil.example/sw.js"
  for (const source of [window, { scriptURL: worker.scriptURL }, foreign, new Worker(), null]) {
    expect(send(probe, source).postMessage).not.toHaveBeenCalled()
    send(open, source)
  }
  send(open, worker, "https://evil.example")
  send({ ...open, version: 2 })
  expect(select).not.toHaveBeenCalled()
  workers.controller = null
  expect(send(probe).postMessage).toHaveBeenCalledOnce()
  worker.scriptURL = `${location.origin}/unrelated.js`
  expect(send(probe).postMessage).not.toHaveBeenCalled()
})

it("validates identifiers and only builds same-origin app URLs", async () => {
  await act(async () => root.render(<Receiver enrolled />))
  for (const sessionKey of [null, "", 42, "bad\nkey", "a".repeat(4098)]) send({ ...open, sessionKey })
  expect(select).not.toHaveBeenCalled()
  send({ ...open, sessionKey: "https://evil.example/?secret#hash" })
  expect(location.pathname).toBe("/app")
  expect(new URLSearchParams(location.search).get("session")).toBe("https://evil.example/?secret#hash")
  await act(async () => root.render(null))
  expect(send(probe).postMessage).not.toHaveBeenCalled()
})
