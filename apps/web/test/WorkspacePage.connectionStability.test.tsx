/** @vitest-environment jsdom */

import { act, useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SESSION_LIST_MAX_AGE_MS, WorkspacePage } from "../src/pages/WorkspacePage"
import type { RoutedSession } from "../src/features/relay"

const mocks = vi.hoisted(() => ({ useRelay: vi.fn(), sessionDetail: { mounts: 0, unmounts: 0, nextIdentity: 0 } }))

vi.mock("../src/features/relay", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/features/relay")>(),
  useRelay: mocks.useRelay,
}))
vi.mock("../src/features/pairing", () => ({ routeForEnrollment: () => undefined, PairingScreen: () => <div data-testid="pairing" /> }))
vi.mock("../src/features/pwa", () => ({ pwaBuildFromModuleScriptUrls: () => "test" }))
vi.mock("../src/features/session", () => ({
  SessionDetail: ({ session, onBack, loadCache }: { session: { id: string }; onBack: () => void; loadCache: (resource: string) => Promise<string | undefined> }) => {
    const [identity] = useState(() => ++mocks.sessionDetail.nextIdentity)
    const [cached, setCached] = useState<string>()
    useEffect(() => { void loadCache("messages").then(setCached) }, [loadCache])
    useEffect(() => {
      ++mocks.sessionDetail.mounts
      return () => { ++mocks.sessionDetail.unmounts }
    }, [])
    return <div data-testid="session-detail" data-instance-id={identity}>Session detail: {session.id}{cached}<button onClick={onBack}>Back</button></div>
  },
  promptDeliveryState: () => "failed",
}))

const relay = { id: "relay", name: "Desktop", hostname: "host", platform: "linux", arch: "x64", workspace: "/workspace", workspaceId: "workspace" }
const now = new Date("2026-08-29T12:00:00.000Z").valueOf()
const session = { id: "session", title: "Cached session", directory: "/workspace", status: "idle" as const, updatedAt: now, additions: 0, deletions: 0, files: 0, workspaceRelayId: "relay", workspaceId: "workspace" }

const relayState = (connection: "online" | "connecting" | "unstable" | "offline" | "disconnected", sessions: RoutedSession[] = [session]) => ({
  connection,
  enrolled: true,
  relay,
  relays: [relay],
  sessions,
  agents: [],
  permissions: [],
  questions: [],
  subagentsByRoot: new Map(),
  sessionRevisions: {},
  resourceRevisions: {},
  notificationsEnabled: false,
  error: undefined,
  relayHealth: {},
  serviceConnected: connection === "online",
  lastSyncedAt: undefined,
  isRelayConnected: (relayId: string) => connection === "online" && relayId === "relay",
  request: vi.fn(),
  loadCache: vi.fn().mockResolvedValue(undefined),
  saveCache: vi.fn().mockResolvedValue(undefined),
  setError: vi.fn(),
  toggleNotifications: vi.fn(),
  disconnect: vi.fn(),
  connect: vi.fn(),
})

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe("WorkspacePage connection stability", () => {
  let container: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  let rootUnmounted: boolean

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    history.replaceState({}, "", "/app?session=session")
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    rootUnmounted = false
    mocks.sessionDetail.mounts = 0
    mocks.sessionDetail.unmounts = 0
    mocks.sessionDetail.nextIdentity = 0
  })

  afterEach(async () => {
    if (!rootUnmounted) await act(async () => root.unmount())
    container.remove()
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it("keeps the selected cached session detail mounted through transient connection states", async () => {
    for (const connection of ["online", "connecting", "unstable", "offline", "disconnected"] as const) {
      mocks.useRelay.mockReturnValue(relayState(connection))
      await act(async () => root.render(<WorkspacePage />))

      expect(container.querySelector("[data-testid=session-detail]")?.textContent).toContain("session")
      expect(container.querySelector("[data-testid=session-detail]")?.getAttribute("data-instance-id")).toBe("1")
      expect(container.querySelector(".session-list")?.textContent).not.toContain("Workspace offline")
      expect(container.querySelector(".inbox-count")?.textContent).toBe(connection === "online" ? "1" : "0")
      expect(container.querySelector(".app-shell")?.classList.contains("has-selection")).toBe(true)
    }
    expect(mocks.sessionDetail.mounts).toBe(1)
    expect(mocks.sessionDetail.unmounts).toBe(0)

    await act(async () => root.unmount())
    rootUnmounted = true
    expect(mocks.sessionDetail.unmounts).toBe(1)
  })

  it("shows the waiting UI when no cached sessions exist", async () => {
    mocks.useRelay.mockReturnValue(relayState("offline", []))
    await act(async () => root.render(<WorkspacePage />))

    expect(container.querySelector("[data-testid=session-detail]")).toBeNull()
    expect(container.textContent).toContain("Waiting for the local relay.")
  })

  it("renders the actual error in the shared toast with dismissal and the existing six-second lifetime", async () => {
    const state = { ...relayState("online"), error: "Snapshot failed: the workspace is unavailable" }
    mocks.useRelay.mockReturnValue(state)
    await act(async () => root.render(<WorkspacePage />))
    expect(container.querySelector('.ui-toast[role="alert"] .ui-notice-content')?.textContent).toBe(state.error)
    await act(async () => vi.advanceTimersByTime(5_999))
    expect(state.setError).not.toHaveBeenCalled()
    await act(async () => vi.advanceTimersByTime(1))
    expect(state.setError).toHaveBeenCalledExactlyOnceWith(undefined)
    state.setError.mockClear()
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Dismiss error"]')!.click())
    expect(state.setError).toHaveBeenCalledExactlyOnceWith(undefined)
  })

  it("hides disconnected rows without changing cached selection and restores Ready rows on reconnect", async () => {
    const connected = new Set(["relay"])
    const state = { ...relayState("online"), isRelayConnected: (id: string) => connected.has(id) }
    state.loadCache.mockResolvedValue("Cached conversation remains readable")
    mocks.useRelay.mockReturnValue(state)
    await act(async () => root.render(<WorkspacePage />))
    expect(container.querySelector(".session-list")?.textContent).toContain("Cached session")

    connected.clear()
    await act(async () => root.render(<WorkspacePage />))
    expect(container.querySelector(".session-list")?.textContent).not.toContain("Cached session")
    expect(container.textContent).toContain("No connected workspace sessions.")
    expect(container.querySelector(".session-list .spin")).toBeNull()
    expect(container.querySelector(".workspace-group")).toBeNull()
    expect(state.sessions).toEqual([session])
    expect(container.querySelector("[data-testid=session-detail]")?.textContent).toContain("Cached conversation remains readable")
    expect(state.loadCache).toHaveBeenCalledExactlyOnceWith("workspace", "messages", "session")
    expect(container.querySelector("[data-testid=session-detail]")?.getAttribute("data-instance-id")).toBe("1")
    expect(location.search).toBe("?session=session")
    expect(state.saveCache).not.toHaveBeenCalled()

    connected.add("relay")
    await act(async () => root.render(<WorkspacePage />))
    expect(container.querySelector(".session-list")?.textContent).toContain("Cached session")
    expect(container.querySelector(".inbox-count")?.textContent).toBe("1")
    expect(mocks.sessionDetail.mounts).toBe(1)
    expect(mocks.sessionDetail.unmounts).toBe(0)
  })

  it("shows a settled empty list when the service is online but all workspaces are offline", async () => {
    mocks.useRelay.mockReturnValue({ ...relayState("offline"), serviceConnected: true })
    await act(async () => root.render(<WorkspacePage />))
    expect(container.textContent).toContain("No connected workspace sessions.")
    expect(container.textContent).not.toContain("Open a new OpenCode session")
    expect(container.querySelector(".session-list .spin")).toBeNull()
    expect(container.querySelector("[data-testid=session-detail]")).not.toBeNull()
  })

  it("lists, counts, and filters connected sessions within three days even while unstable", async () => {
    const sessions: RoutedSession[] = [
      { ...session, title: "Ready session", updatedAt: now - SESSION_LIST_MAX_AGE_MS },
      { ...session, id: "busy", title: "Busy session", status: "busy" },
      { ...session, id: "offline", title: "Offline session", workspaceRelayId: "offline" },
      { ...session, id: "old", title: "Old session", directory: "/old", updatedAt: now - SESSION_LIST_MAX_AGE_MS - 1 },
      { ...session, id: "other", title: "Offline folder", directory: "/other", workspaceRelayId: "offline" },
    ]
    mocks.useRelay.mockReturnValue({
      ...relayState("unstable", sessions),
      serviceConnected: true,
      relays: [relay, { ...relay, id: "offline" }],
      isRelayConnected: (id: string) => id === "relay",
      permissions: [{ workspaceRelayId: "offline", sessionID: "offline" }, { workspaceRelayId: "relay", sessionID: "busy" }],
    })
    await act(async () => root.render(<WorkspacePage />))
    const list = container.querySelector(".session-list")!
    expect(list.textContent).toContain("Ready session")
    expect(list.textContent).toContain("Busy session")
    expect(list.textContent).not.toContain("Offline")
    expect(list.textContent).not.toContain("Old session")
    expect(list.querySelectorAll(".workspace-group")).toHaveLength(0)
    expect([...list.querySelectorAll(".session-row strong")].map(row => row.textContent)).toEqual(["Busy session", "Ready session"])
    expect(container.querySelector(".inbox-count")?.textContent).toBe("2")
    expect(container.querySelector(".navigator-attention")?.textContent).toBe("1 session needs your attention")
    expect(container.textContent).toContain("1 connected workspace")
    const pills = [...container.querySelectorAll<HTMLButtonElement>(".folder-filters button")]
    expect(pills.map(pill => pill.title)).toEqual(["/workspace"])
    await act(async () => pills[0]!.click())
    expect(list.querySelectorAll(".session-row")).toHaveLength(0)
    expect(container.querySelector(".inbox-count")?.textContent).toBe("0")
    await act(async () => pills[0]!.click())
    expect([...list.querySelectorAll(".session-row strong")].map(row => row.textContent)).toEqual(["Busy session", "Ready session"])
    expect(container.querySelector(".inbox-count")?.textContent).toBe("2")
  })

  it("shows folder overflow only while content remains to the right, including after folders return", async () => {
    const state = relayState("online", [])
    mocks.useRelay.mockReturnValue(state)
    await act(async () => root.render(<WorkspacePage />))
    expect(container.querySelector(".folder-filters-row")).toBeNull()
    state.sessions = [session, { ...session, id: "other", directory: "/other" }]
    await act(async () => root.render(<WorkspacePage />))
    const row = container.querySelector<HTMLDivElement>(".folder-filters")!
    const wrapper = row.parentElement!
    let contentWidth = 600
    Object.defineProperties(row, {
      clientWidth: { get: () => 288 },
      scrollWidth: { get: () => contentWidth },
    })
    await act(async () => window.dispatchEvent(new Event("resize")))
    expect(wrapper.dataset.overflowRight).toBe("true")
    await act(async () => row.querySelector("button")!.focus())
    expect(wrapper.dataset.overflowRight).toBe("true")
    await act(async () => { row.scrollLeft = 312; row.dispatchEvent(new Event("scroll")) })
    expect(wrapper.dataset.overflowRight).toBe("false")
    await act(async () => { row.scrollLeft = 0; row.dispatchEvent(new Event("scroll")) })
    expect(wrapper.dataset.overflowRight).toBe("true")
    contentWidth = 288
    await act(async () => window.dispatchEvent(new Event("resize")))
    expect(wrapper.dataset.overflowRight).toBe("false")
  })

  it("filters folders independently, retains selection and preferences, and enables new folders", async () => {
    const sessions: RoutedSession[] = [
      { ...session, directory: "/one/app", status: "busy" },
      { ...session, id: "input", title: "Input", directory: "/two/app" },
      { ...session, id: "ready", title: "Ready", directory: "/ready" },
    ]
    const state = { ...relayState("online", sessions), questions: [{ workspaceRelayId: "relay", sessionID: "input" }] }
    mocks.useRelay.mockReturnValue(state)
    await act(async () => root.render(<WorkspacePage />))
    const pills = () => [...container.querySelectorAll<HTMLButtonElement>('.folder-filters button')]
    const titles = () => [...container.querySelectorAll('.session-row strong')].map(row => row.textContent)
    expect(pills()).toHaveLength(3)
    expect(pills().every(pill => pill.getAttribute("aria-pressed") === "true")).toBe(true)
    expect(pills().map(pill => pill.textContent)).toEqual(["/one/app", "/two/app", "ready"])
    expect(titles()).toEqual(["Input", "Cached session", "Ready"])
    await act(async () => pills()[1]!.click())
    expect(titles()).toEqual(["Cached session", "Ready"])
    expect(container.querySelector('.navigator-attention')).toBeNull()
    expect(container.querySelector('.inbox-count')?.textContent).toBe("2")
    await act(async () => pills()[0]!.click())
    expect(titles()).toEqual(["Ready"])
    expect(mocks.sessionDetail.mounts).toBe(1)
    expect(mocks.sessionDetail.unmounts).toBe(0)
    await act(async () => pills()[2]!.click())
    expect(container.textContent).toContain("No folders selected.")
    expect(pills()).toHaveLength(3)
    state.sessions = []
    await act(async () => root.render(<WorkspacePage />))
    state.sessions = [...sessions, { ...session, id: "new", title: "New folder session", directory: "/new" }]
    await act(async () => root.render(<WorkspacePage />))
    expect(titles()).toEqual(["New folder session"])
    await act(async () => pills().find(pill => pill.title === "/one/app")!.click())
    expect(titles()).toEqual(["Cached session", "New folder session"])
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid=session-detail] button')!.click())
    expect(titles()).toEqual(["Cached session", "New folder session"])
    for (const pill of pills().filter(pill => pill.getAttribute("aria-pressed") === "true")) {
      await act(async () => pill.click())
    }
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === "Show all folders")!.click())
    expect(titles()).toEqual(["Input", "Cached session", "New folder session", "Ready"])
    expect(container.querySelector('.inbox-count')?.textContent).toBe("4")
  })

  it("dismisses settings with focus restored and keeps utility actions connected", async () => {
    history.replaceState({}, "", "/app")
    const state = relayState("online")
    mocks.useRelay.mockReturnValue(state)
    await act(async () => root.render(<WorkspacePage />))
    const settings = container.querySelector<HTMLDetailsElement>(".inbox-utilities")!
    const trigger = settings.querySelector("summary")!
    await act(async () => trigger.click())
    expect(settings.open).toBe(true)
    expect(settings.querySelector('a')?.textContent).toBe("View source")
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })))
    expect(settings.open).toBe(false)
    expect(document.activeElement).toBe(trigger)
    await act(async () => trigger.click())
    await act(async () => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })))
    expect(settings.open).toBe(false)
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Enable notifications"]')!.click())
    expect(state.toggleNotifications).toHaveBeenCalledOnce()
    await act(async () => trigger.click())
    const disconnect = [...settings.querySelectorAll("button")].find(button => button.textContent === "Disconnect")!
    await act(async () => disconnect.click())
    expect(state.disconnect).toHaveBeenCalledOnce()
    expect(location.pathname).toBe("/pair")
  })

  it("shows recent sessions and hides sessions strictly older than three days", async () => {
    const recent = { ...session, id: "recent", title: "Recent session", updatedAt: new Date("2026-08-26T12:00:00.001Z").valueOf() }
    const old = { ...session, id: "old", title: "Old session", updatedAt: new Date("2026-08-26T11:59:59.999Z").valueOf() }
    history.replaceState({}, "", "/app")
    mocks.useRelay.mockReturnValue(relayState("online", [recent, old]))

    await act(async () => root.render(<WorkspacePage />))

    expect(container.textContent).toContain("Recent session")
    expect(container.textContent).not.toContain("Old session")
  })

  it("ages a session out after the next thirty-second clock tick without reloading", async () => {
    const expiring = { ...session, id: "expiring", title: "Expiring session", updatedAt: now - SESSION_LIST_MAX_AGE_MS + 1 }
    history.replaceState({}, "", "/app")
    mocks.useRelay.mockReturnValue(relayState("online", [expiring]))

    await act(async () => root.render(<WorkspacePage />))
    expect(container.textContent).toContain("Expiring session")

    await act(async () => { vi.advanceTimersByTime(30_000) })

    expect(container.textContent).not.toContain("Expiring session")
  })

  it("keeps a session updated exactly three days ago in the list", async () => {
    expect(SESSION_LIST_MAX_AGE_MS).toBe(72 * 60 * 60 * 1_000)
    const cutoff = { ...session, id: "cutoff", title: "Cutoff session", updatedAt: new Date("2026-08-26T12:00:00.000Z").valueOf() }
    history.replaceState({}, "", "/app")
    mocks.useRelay.mockReturnValue(relayState("online", [cutoff]))

    await act(async () => root.render(<WorkspacePage />))

    expect(container.textContent).toContain("Cutoff session")
  })

  it("renders a deep-linked old session detail while excluding it from the list", async () => {
    const old = { ...session, id: "old", title: "Old session", updatedAt: now - SESSION_LIST_MAX_AGE_MS - 1 }
    history.replaceState({}, "", "/app?session=old")
    const state = relayState("online", [old])
    state.loadCache.mockResolvedValue("Older cached conversation")
    mocks.useRelay.mockReturnValue(state)

    await act(async () => root.render(<WorkspacePage />))

    expect(container.querySelector("[data-testid=session-detail]")?.textContent).toContain("old")
    expect(container.querySelector("[data-testid=session-detail]")?.textContent).toContain("Older cached conversation")
    expect(state.loadCache).toHaveBeenCalledExactlyOnceWith("workspace", "messages", "old")
    expect(state.sessions).toEqual([old])
    expect(state.saveCache).not.toHaveBeenCalled()
    expect(container.textContent).not.toContain("Old session")

    await act(async () => container.querySelector("[data-testid=session-detail] button")?.dispatchEvent(new MouseEvent("click", { bubbles: true })))

    expect(container.querySelector("[data-testid=session-detail]")).toBeNull()
    expect(container.textContent).not.toContain("Old session")
  })

  it("uses empty-list copy when every session is filtered out", async () => {
    const old = { ...session, id: "old", title: "Old session", updatedAt: now - SESSION_LIST_MAX_AGE_MS - 1 }
    history.replaceState({}, "", "/app")
    mocks.useRelay.mockReturnValue(relayState("online", [old]))

    await act(async () => root.render(<WorkspacePage />))

    expect(container.textContent).toContain("Open a new OpenCode session to get started.")
    expect(container.textContent).not.toContain("Old session")
  })
})
