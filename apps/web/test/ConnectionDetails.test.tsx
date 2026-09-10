/** @vitest-environment jsdom */
import { act, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ConnectionDetails } from "../src/features/workspace/ConnectionDetails"
import type { useRelay } from "../src/features/relay"

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const now = Date.now()
const request = vi.fn().mockResolvedValue([])
const setError = vi.fn()
const state = {
  connection: "online", serviceConnected: true, lastSyncedAt: now,
  relays: ["Connected", "Delayed", "Offline"].map((name) => ({ id: name, name, workspace: `/projects/${name}` })),
  isRelayConnected: (id: string) => id !== "Offline",
  relayHealth: { Connected: { rtt: 0, lastContact: now - 2_000 }, Delayed: { timedOut: true, lastContact: now - 90_000 } },
  request, setError,
} as unknown as ReturnType<typeof useRelay>

function Fixture({ relayState = state }: { relayState?: ReturnType<typeof useRelay> }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  return <><button ref={triggerRef} onClick={() => setOpen(true)}>Live</button>{open && <ConnectionDetails relayState={relayState} onClose={() => setOpen(false)} triggerRef={triggerRef} />}</>
}

describe("Connection details", () => {
  let container: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  beforeEach(() => {
    request.mockResolvedValue([])
    vi.useFakeTimers()
    vi.setSystemTime(now)
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { callback(0); return 1 })
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })
  const open = async (relayState = state) => {
    await act(async () => root.render(<Fixture relayState={relayState} />))
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click())
  }
  it("shows workspace statuses, zero latency, exact contact time, sync freshness and build", async () => {
    await open()
    expect(container.querySelector('[role="dialog"]')?.getAttribute("aria-labelledby")).toBe("connection-title")
    expect(container.querySelector(".connection-summary")?.textContent).toContain("Unstable")
    expect(container.querySelector(".connection-workspaces")?.getAttribute("aria-labelledby")).toBe("connection-workspaces-title")
    const workspaces = container.querySelectorAll(".connection-workspace")
    expect(workspaces).toHaveLength(3)
    expect(workspaces[0]?.textContent).toContain("Latency0 msLast contact2 seconds ago")
    expect(workspaces[1]?.textContent).toContain("Unstable")
    expect(workspaces[2]?.textContent).toContain("Offline")
    expect(container.textContent).toContain("OpenCode dataCurrent")
    expect(container.textContent).toContain("PWA build")
    await act(async () => vi.advanceTimersByTime(60_000))
    expect(container.textContent).toContain("OpenCode dataStale")
    expect(workspaces[0]?.textContent).toContain("62 seconds ago")
  })
  it.each(["online", "connecting", "offline", "unstable"] as const)("preserves the %s summary and empty workspace state", async (connection) => {
    await open({ ...state, connection, relays: [], relayHealth: {}, lastSyncedAt: undefined, serviceConnected: false })
    expect(container.querySelector(".connection-summary strong")?.textContent).toBe(connection === "connecting" ? "Connecting" : connection === "unstable" ? "Unstable" : "Offline")
    expect(container.textContent).toContain("No connected workspaces yet.")
    expect(container.textContent).toContain("Unreachable")
    expect(container.textContent).toContain("Not yet synced")
  })
  it("refreshes, handles failure, traps both Tab directions, and restores focus after Escape or Close", async () => {
    await open()
    const buttons = [...container.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
    expect(document.activeElement).toBe(buttons[0])
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(buttons[2])
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(buttons[0])
    await act(async () => buttons[2]!.click())
    expect(request).toHaveBeenCalledWith({ type: "snapshot.request" })
    request.mockRejectedValueOnce(new Error("Refresh failed"))
    await act(async () => buttons[2]!.click())
    expect(setError).toHaveBeenCalledWith("Refresh failed")
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })))
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(container.querySelector("button"))
    await open()
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Close connection status"]')!.click())
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(container.querySelector("button"))
  })
})
