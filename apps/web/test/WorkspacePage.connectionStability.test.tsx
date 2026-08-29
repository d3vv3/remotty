/** @vitest-environment jsdom */

import { act, useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SESSION_LIST_MAX_AGE_MS, WorkspacePage } from "../src/pages/WorkspacePage"

const mocks = vi.hoisted(() => ({ useRelay: vi.fn(), sessionDetail: { mounts: 0, unmounts: 0, nextIdentity: 0 } }))

vi.mock("../src/features/relay", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/features/relay")>(),
  useRelay: mocks.useRelay,
}))
vi.mock("../src/features/pairing", () => ({ routeForEnrollment: () => undefined, PairingScreen: () => <div data-testid="pairing" /> }))
vi.mock("../src/features/pwa", () => ({ pwaBuildFromModuleScriptUrls: () => "test" }))
vi.mock("../src/features/session", () => ({
  SessionDetail: ({ session, onBack }: { session: { id: string }; onBack: () => void }) => {
    const [identity] = useState(() => ++mocks.sessionDetail.nextIdentity)
    useEffect(() => {
      ++mocks.sessionDetail.mounts
      return () => { ++mocks.sessionDetail.unmounts }
    }, [])
    return <div data-testid="session-detail" data-instance-id={identity}>Session detail: {session.id}<button onClick={onBack}>Back</button></div>
  },
  promptDeliveryState: () => "failed",
}))

const relay = { id: "relay", name: "Desktop", hostname: "host", platform: "linux", arch: "x64", workspace: "/workspace", workspaceId: "workspace" }
const now = new Date("2026-08-29T12:00:00.000Z").valueOf()
const session = { id: "session", title: "Cached session", directory: "/workspace", status: "idle" as const, updatedAt: now, additions: 0, deletions: 0, files: 0, workspaceRelayId: "relay", workspaceId: "workspace" }

const relayState = (connection: "online" | "connecting" | "unstable" | "offline" | "disconnected", sessions = [session]) => ({
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
      expect(container.textContent).not.toContain("Waiting for the local relay.")
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

  it("shows recent sessions and hides sessions strictly older than one week", async () => {
    const recent = { ...session, id: "recent", title: "Recent session", updatedAt: now - SESSION_LIST_MAX_AGE_MS + 1 }
    const old = { ...session, id: "old", title: "Old session", updatedAt: now - SESSION_LIST_MAX_AGE_MS - 1 }
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

  it("keeps a session updated exactly one week ago in the list", async () => {
    const cutoff = { ...session, id: "cutoff", title: "Cutoff session", updatedAt: now - SESSION_LIST_MAX_AGE_MS }
    history.replaceState({}, "", "/app")
    mocks.useRelay.mockReturnValue(relayState("online", [cutoff]))

    await act(async () => root.render(<WorkspacePage />))

    expect(container.textContent).toContain("Cutoff session")
  })

  it("renders a deep-linked old session detail while excluding it from the list", async () => {
    const old = { ...session, id: "old", title: "Old session", updatedAt: now - SESSION_LIST_MAX_AGE_MS - 1 }
    history.replaceState({}, "", "/app?session=old")
    mocks.useRelay.mockReturnValue(relayState("online", [old]))

    await act(async () => root.render(<WorkspacePage />))

    expect(container.querySelector("[data-testid=session-detail]")?.textContent).toContain("old")
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
