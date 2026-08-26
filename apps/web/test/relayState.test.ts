import { describe, expect, it } from "vitest"
import { acceptsRelayPosition, acceptsWorkspaceRelayPosition, aggregateRelaySlices, bumpSessionRevisions, commandRelayId, handoffRelayHello, normalizeRelaySlice, relaySupportsSessionCreate, resolveConnectedWorkspaceRelay, sessionRevisionKey, stableWorkspaceKey, workspaceSessionKey, type RelaySlice } from "../src/features/relay/relayState"
import { visibleSubagents } from "../src/features/session/model/subagentActivityState"

const slice = (id: string, sessionId: string, updatedAt: number): RelaySlice => ({
  relay: { id, name: id, hostname: "host", platform: "linux", arch: "x64", workspace: `/${id}` },
  sessions: [{
    id: sessionId,
    title: sessionId,
    directory: `/${id}`,
    status: "idle",
    updatedAt,
    additions: 0,
    deletions: 0,
    files: 0,
  }],
  agents: [{ name: "build", mode: "primary" }],
  permissions: [],
    questions: [],
    subagents: [],
})

describe("relay snapshot aggregation and routing", () => {
  it("shows all active subagents before the three newest inactive children without mutating the input", () => {
    const children = [
      { id: "idle-old", status: "idle", updatedAt: 1 },
      { id: "busy-old", status: "busy", updatedAt: 4 },
      { id: "idle-new", status: "idle", updatedAt: 6 },
      { id: "retry", status: "retry", updatedAt: 3 },
      { id: "idle-mid", status: "idle", updatedAt: 5 },
      { id: "busy-new", status: "busy", updatedAt: 7 },
      { id: "idle-fourth", status: "idle", updatedAt: 2 },
    ] as const

    expect(visibleSubagents(children).map((child) => child.id)).toEqual([
      "busy-new", "busy-old", "retry", "idle-new", "idle-mid", "idle-fourth",
    ])
    expect(children.map((child) => child.id)).toEqual([
      "idle-old", "busy-old", "idle-new", "retry", "idle-mid", "busy-new", "idle-fourth",
    ])
  })

  it("limits inactive-only subagents by recency", () => {
    const children = [
      { id: "old", status: "idle", updatedAt: 1 },
      { id: "new", status: "completed", updatedAt: 4 },
      { id: "middle", status: "idle", updatedAt: 3 },
      { id: "recent", status: "idle", updatedAt: 2 },
    ] as const

    expect(visibleSubagents(children).map((child) => child.id)).toEqual(["new", "middle", "recent"])
  })

  it("aggregates snapshots and associates sessions with workspace relays", () => {
    const state = aggregateRelaySlices(new Map([
      ["relay-a", slice("relay-a", "session-a", 1)],
      ["relay-b", slice("relay-b", "session-b", 2)],
    ]))
    expect(state.relays.map((relay) => relay.id)).toEqual(["relay-a", "relay-b"])
    expect(state.sessions.map((session) => [session.id, session.workspaceRelayId])).toEqual([
      ["session-b", "relay-b"],
      ["session-a", "relay-a"],
    ])
    expect(state.agents.map((agent) => agent.workspaceRelayId)).toEqual(["relay-a", "relay-b"])
    expect(commandRelayId({ type: "session.messages", sessionId: "session-a" }, state.relays.map((relay) => relay.id), state.sessionRelays)).toBe("relay-a")
  })

  it("exposes primary and all-mode agents but not subagents", () => {
    const current = slice("relay-a", "session-a", 1)
    current.agents.push({ name: "explore", mode: "all" })

    expect(aggregateRelaySlices(new Map([["relay-a", current]])).agents.map((agent) => agent.name)).toEqual(["build", "explore"])
  })

  it("does not guess a relay for an unknown session in a multi-relay room", () => {
    expect(commandRelayId({ type: "session.messages", sessionId: "missing" }, ["relay-a", "relay-b"], new Map())).toBeUndefined()
  })

  it("requires an explicit session creation capability", () => {
    expect(relaySupportsSessionCreate({ capabilities: { sessionCreate: 1 } })).toBe(true)
    expect(relaySupportsSessionCreate({ capabilities: { ping: true } })).toBe(false)
    expect(relaySupportsSessionCreate({})).toBe(false)
  })

  it("merges duplicate sessions and routes to the active instance", () => {
    const idle = slice("relay-a", "session-a", 10)
    const busy = slice("relay-b", "session-a", 10)
    busy.relay.workspace = idle.relay.workspace
    busy.sessions[0]!.status = "busy"

    const state = aggregateRelaySlices(new Map([["relay-a", idle], ["relay-b", busy]]))

    expect(state.sessions).toHaveLength(1)
    expect(state.sessions[0]).toMatchObject({ id: "session-a", status: "busy", workspaceRelayId: "relay-b" })
    expect(commandRelayId({ type: "session.messages", sessionId: "session-a" }, state.relays.map((relay) => relay.id), state.sessionRelays))
      .toBe("relay-b")
  })

  it("excludes disconnected slices before deduplicating and routing sessions", () => {
    const connected = slice("connected", "session-a", 1)
    const disconnected = slice("disconnected", "session-a", 100)
    disconnected.relay.workspace = connected.relay.workspace
    disconnected.sessions[0]!.status = "busy"
    connected.permissions = [{ id: "permission-a", sessionID: "session-a", permission: "bash", patterns: [], metadata: {}, always: [] }]
    disconnected.permissions = [{ id: "permission-b", sessionID: "session-a", permission: "write", patterns: [], metadata: {}, always: [] }]
    disconnected.questions = [{ id: "question-a", sessionID: "session-a", questions: [] }]

    const state = aggregateRelaySlices(new Map([["connected", connected], ["disconnected", disconnected]]), ["connected"])

    expect(state.relays.map((relay) => relay.id)).toEqual(["connected", "disconnected"])
    expect(state.sessions).toMatchObject([{ id: "session-a", status: "idle", workspaceRelayId: "connected" }])
    expect(state.permissions.map((permission) => permission.id)).toEqual(["permission-a"])
    expect(state.questions).toEqual([])
    expect(state.sessionRelays.get("session-a")).toBe("connected")
    expect(commandRelayId({ type: "session.messages", sessionId: "session-a" }, ["connected"], state.sessionRelays)).toBe("connected")
  })

  it("keeps cached sessions and subagents visible when no relay is connected, without routing requests", () => {
    const cached = slice("cached", "root", 1)
    cached.subagents = [{ ...cached.sessions[0]!, id: "child", parentSessionId: "root", rootSessionId: "root" }]
    const state = aggregateRelaySlices(new Map([["cached", cached]]), [])

    expect(state.sessions.map((session) => session.id)).toEqual(["root"])
    expect(state.subagents.map((session) => session.id)).toEqual(["child"])
    expect(state.sessionRelays.get("root")).toBe("cached")
    expect(commandRelayId({ type: "session.messages", sessionId: "root" }, [], state.sessionRelays)).toBeUndefined()
  })

  it("keeps offline workspaces visible alongside active workspaces while excluding stale live data", () => {
    const active = slice("active", "active-session", 1)
    const offline = slice("offline", "offline-session", 2)
    offline.agents = [{ name: "stale", mode: "primary" }]
    offline.permissions = [{ id: "stale-permission", sessionID: "offline-session", permission: "bash", patterns: [], metadata: {}, always: [] }]
    offline.questions = [{ id: "stale-question", sessionID: "offline-session", questions: [] }]
    const state = aggregateRelaySlices(new Map([["active", active], ["offline", offline]]), ["active"])

    expect(state.sessions.map((session) => session.id)).toEqual(["offline-session", "active-session"])
    expect(state.agents.map((agent) => agent.name)).toEqual(["build"])
    expect(state.permissions).toEqual([])
    expect(state.questions).toEqual([])
  })

  it("does not let a disconnected duplicate override the active workspace", () => {
    const active = slice("active", "session", 1)
    const cached = slice("cached", "session", 100)
    cached.relay.workspace = active.relay.workspace
    cached.sessions[0]!.status = "busy"
    const state = aggregateRelaySlices(new Map([["active", active], ["cached", cached]]), ["active"])

    expect(state.sessions).toMatchObject([{ id: "session", status: "idle", workspaceRelayId: "active" }])
  })

  it("hands off cached summaries to a restarted relay and clears stale live state", () => {
    const old = slice("old", "root", 1)
    old.relay.workspaceId = "workspace"
    old.subagents = [{ ...old.sessions[0]!, id: "child", parentSessionId: "root", rootSessionId: "root" }]
    old.agentTheme = { name: "old", mode: "dark", colors: { secondary: "#010203", accent: "#040506", success: "#070809", warning: "#0a0b0c", primary: "#0d0e0f", error: "#101112", info: "#131415" } }
    old.permissions = [{ id: "permission", sessionID: "root", permission: "bash", patterns: [], metadata: {}, always: [] }]
    old.questions = [{ id: "question", sessionID: "root", questions: [] }]
    const relay = { ...old.relay, id: "new", instanceId: "new-instance", instanceStartedAt: 2 }
    const handoff = handoffRelayHello(new Map([["old", old]]), [], "new", relay, 4)

    expect(handoff.accepted).toBe(true)
    if (!handoff.accepted) return
    expect(handoff.superseded).toEqual(["old"])
    expect(handoff.slices.get("new")).toMatchObject({ relay, sequence: 4, sessions: old.sessions, subagents: old.subagents, agents: [], permissions: [], questions: [] })
    expect(handoff.slices.get("new")?.agentTheme).toBeUndefined()
  })

  it("clears stale live state during a same-id relay restart hello", () => {
    const current = slice("relay", "root", 1)
    current.agents = [{ name: "stale", mode: "primary" }]
    const relay = { ...current.relay, instanceId: "restarted", instanceStartedAt: 2 }
    const handoff = handoffRelayHello(new Map([["relay", current]]), ["relay"], "relay", relay, 3)

    expect(handoff.accepted).toBe(true)
    if (!handoff.accepted) return
    expect(handoff.superseded).toEqual([])
    expect(handoff.slices.get("relay")).toMatchObject({ relay, sequence: 3, sessions: current.sessions, subagents: [], agents: [], permissions: [], questions: [] })
  })

  it("rejects a delayed older new-id hello without replacing a newer workspace slice", () => {
    const retained = slice("newer", "root", 1)
    retained.relay.workspaceId = "workspace"
    retained.relay.instanceId = "newer-instance"
    retained.relay.instanceStartedAt = 20
    const relay = { ...retained.relay, id: "delayed", instanceId: "older-instance", instanceStartedAt: 10 }
    const slices = new Map([["newer", retained]])

    const handoff = handoffRelayHello(slices, ["newer"], "delayed", relay, 100)

    expect(handoff).toEqual({ accepted: false })
    expect(slices).toEqual(new Map([["newer", retained]]))
  })

  it("rejects a delayed older snapshot after its hello was rejected", () => {
    const retained = slice("newer", "root", 1)
    retained.relay.workspaceId = "workspace"
    retained.relay.instanceId = "newer-instance"
    retained.relay.instanceStartedAt = 20
    retained.sequence = 5
    const delayed = { ...retained.relay, id: "delayed", instanceId: "older-instance", instanceStartedAt: 10 }
    const slices = new Map([["newer", retained]])

    expect(handoffRelayHello(slices, ["newer"], "delayed", delayed, 100)).toEqual({ accepted: false })
    expect(acceptsWorkspaceRelayPosition(slices, ["newer"], "delayed", delayed, 101)).toBe(false)
  })

  it("rejects an equal-timestamp different instance while its workspace peer is connected", () => {
    const retained = slice("connected", "root", 1)
    retained.relay.workspaceId = "workspace"
    retained.relay.instanceId = "connected-instance"
    retained.relay.instanceStartedAt = 20
    const incoming = { ...retained.relay, id: "incoming", instanceId: "incoming-instance" }

    expect(acceptsWorkspaceRelayPosition(new Map([["connected", retained]]), ["connected", "incoming"], "incoming", incoming, 1)).toBe(false)
  })

  it("accepts an equal-timestamp different instance when the retained workspace slice is cached", () => {
    const retained = slice("cached", "root", 1)
    retained.relay.workspaceId = "workspace"
    retained.relay.instanceId = "cached-instance"
    retained.relay.instanceStartedAt = 20
    const incoming = { ...retained.relay, id: "incoming", instanceId: "incoming-instance" }

    expect(acceptsWorkspaceRelayPosition(new Map([["cached", retained]]), ["incoming"], "incoming", incoming, 1)).toBe(true)
  })

  it("does not let a delayed equal-timestamp frame replace a connected workspace peer", () => {
    const retained = slice("connected", "root", 1)
    retained.relay.workspaceId = "workspace"
    retained.relay.instanceId = "connected-instance"
    retained.relay.instanceStartedAt = 20
    const delayed = { ...retained.relay, id: "delayed", instanceId: "delayed-instance" }
    const slices = new Map([["connected", retained]])

    expect(handoffRelayHello(slices, ["connected", "delayed"], "delayed", delayed, 100)).toEqual({ accepted: false })
    expect(slices).toEqual(new Map([["connected", retained]]))
  })

  it("rejects an old-sequence snapshot from the same instance under a new relay ID", () => {
    const retained = slice("old-id", "root", 1)
    retained.relay.workspaceId = "workspace"
    retained.relay.instanceId = "instance"
    retained.relay.instanceStartedAt = 20
    retained.sequence = 10
    const snapshotRelay = { ...retained.relay, id: "new-id" }

    expect(acceptsWorkspaceRelayPosition(new Map([["old-id", retained]]), ["old-id"], "new-id", snapshotRelay, 10)).toBe(false)
  })

  it("accepts a newer-sequence snapshot from the same instance under a new relay ID", () => {
    const retained = slice("old-id", "root", 1)
    retained.relay.workspaceId = "workspace"
    retained.relay.instanceId = "instance"
    retained.relay.instanceStartedAt = 20
    retained.sequence = 10
    const snapshotRelay = { ...retained.relay, id: "new-id" }

    expect(acceptsWorkspaceRelayPosition(new Map([["old-id", retained]]), ["old-id"], "new-id", snapshotRelay, 11)).toBe(true)
  })

  it("accepts a newer instance snapshot even when its sequence restarts low", () => {
    const retained = slice("old-id", "root", 1)
    retained.relay.workspaceId = "workspace"
    retained.relay.instanceId = "old-instance"
    retained.relay.instanceStartedAt = 20
    retained.sequence = 100
    const snapshotRelay = { ...retained.relay, id: "new-id", instanceId: "new-instance", instanceStartedAt: 21 }

    expect(acceptsWorkspaceRelayPosition(new Map([["old-id", retained]]), ["old-id"], "new-id", snapshotRelay, 1)).toBe(true)
  })

  it("hands off cached summaries when the same instance reconnects with a new relay ID", () => {
    const retained = slice("old-id", "root", 1)
    retained.relay.workspaceId = "workspace"
    retained.relay.instanceId = "instance"
    retained.relay.instanceStartedAt = 20
    retained.subagents = [{ ...retained.sessions[0]!, id: "child", parentSessionId: "root", rootSessionId: "root" }]
    const relay = { ...retained.relay, id: "new-id" }

    const handoff = handoffRelayHello(new Map([["old-id", retained]]), [], "new-id", relay, 2)

    expect(handoff.accepted).toBe(true)
    if (!handoff.accepted) return
    expect(handoff.superseded).toEqual(["old-id"])
    expect(handoff.slices.get("new-id")).toMatchObject({ sessions: retained.sessions, subagents: retained.subagents, agents: [], permissions: [], questions: [] })
  })

  it("replaces older workspace slices for a newer relay instance", () => {
    const retained = slice("old", "root", 1)
    retained.relay.workspaceId = "workspace"
    retained.relay.instanceId = "old-instance"
    retained.relay.instanceStartedAt = 10
    const relay = { ...retained.relay, id: "new", instanceId: "new-instance", instanceStartedAt: 20 }

    const handoff = handoffRelayHello(new Map([["old", retained]]), ["old"], "new", relay, 1)

    expect(handoff.accepted).toBe(true)
    if (!handoff.accepted) return
    expect([...handoff.slices.keys()]).toEqual(["new"])
    expect(handoff.superseded).toEqual(["old"])
  })

  it("keeps child summaries out of the main list while routing their commands", () => {
    const current = slice("relay-a", "root", 1)
    current.relay.capabilities = { subagents: 1 }
    current.subagents = [{ ...current.sessions[0]!, id: "child", parentSessionId: "root", rootSessionId: "root" }]
    const state = aggregateRelaySlices(new Map([["relay-a", current]]))
    expect(state.sessions.map((session) => session.id)).toEqual(["root"])
    expect(state.subagentsByRoot.get(workspaceSessionKey(stableWorkspaceKey(current.relay), "root"))?.map((session) => session.id)).toEqual(["child"])
    expect(commandRelayId({ type: "session.messages", sessionId: "child" }, ["relay-a"], state.sessionRelays)).toBe("relay-a")
  })

  it("keeps same-id subagents scoped to their workspace root", () => {
    const first = slice("first", "root", 1)
    const second = slice("second", "root", 2)
    first.relay.workspaceId = "workspace-one"
    second.relay.workspaceId = "workspace-two"
    first.subagents = [{ ...first.sessions[0]!, id: "child", parentSessionId: "root", rootSessionId: "root" }]
    second.subagents = [{ ...second.sessions[0]!, id: "child", parentSessionId: "root", rootSessionId: "root" }]
    const state = aggregateRelaySlices(new Map([["first", first], ["second", second]]))
    expect(state.subagentsByRoot.get("workspace-one:root")?.[0]?.workspaceRelayId).toBe("first")
    expect(state.subagentsByRoot.get("workspace-two:root")?.[0]?.workspaceRelayId).toBe("second")
    expect(commandRelayId({ type: "session.messages", sessionId: "child", workspaceId: "workspace-one" }, ["first", "second"], state.sessionRelays)).toBe("first")
    expect(commandRelayId({ type: "session.messages", sessionId: "child", workspaceId: "workspace-two" }, ["first", "second"], state.sessionRelays)).toBe("second")
  })

  it("normalizes legacy cached slices without subagents", () => {
    const legacy = slice("relay-a", "root", 1)
    const { subagents: _subagents, ...withoutSubagents } = legacy
    expect(normalizeRelaySlice(withoutSubagents).subagents).toEqual([])
  })

  it("keeps workspace agent palettes isolated and tolerates legacy snapshots", () => {
    const first = slice("first", "one", 1)
    const second = slice("second", "two", 2)
    first.agentTheme = { name: "first", mode: "dark", colors: { secondary: "#010203", accent: "#040506", success: "#070809", warning: "#0a0b0c", primary: "#0d0e0f", error: "#101112", info: "#131415" } }
    const state = aggregateRelaySlices(new Map([["first", first], ["second", second]]))
    expect(state.agents.find((agent) => agent.workspaceRelayId === "first")?.agentTheme?.name).toBe("first")
    expect(state.agents.find((agent) => agent.workspaceRelayId === "second")?.agentTheme).toBeUndefined()
    const { agentTheme: _agentTheme, ...legacy } = first
    expect(normalizeRelaySlice(legacy).agentTheme).toBeUndefined()
  })

  it("rejects rollback within a relay stream and from an older relay instance", () => {
    const current = slice("relay-a", "session-a", 1)
    current.relay.instanceId = "instance-2"
    current.relay.instanceStartedAt = 20
    current.sequence = 10
    expect(acceptsRelayPosition(current, current.relay, 9)).toBe(false)
    expect(acceptsRelayPosition(current, { ...current.relay, instanceId: "instance-1", instanceStartedAt: 10 }, 100)).toBe(false)
    expect(acceptsRelayPosition(current, { ...current.relay, instanceId: "instance-3", instanceStartedAt: 30 }, 0)).toBe(true)
  })

  it("resolves a restarted relay by stable workspace identity", () => {
    const old = slice("old", "s", 1)
    const replacement = slice("new", "s", 2)
    replacement.relay.workspace = old.relay.workspace
    expect(resolveConnectedWorkspaceRelay(stableWorkspaceKey(old.relay), ["new"], new Map([["old", old], ["new", replacement]]))).toBe("new")
  })

  it("invalidates sessions under stable workspace keys across relay restarts", () => {
    const old = slice("old-relay", "one", 1).relay
    old.workspaceId = "stable-workspace"
    const replacement = { ...old, id: "new-relay" }
    const initial = bumpSessionRevisions({}, old, ["one", "two"])
    const refreshed = bumpSessionRevisions(initial, replacement, ["one"])

    expect(sessionRevisionKey(old, "one")).toBe("stable-workspace:one")
    expect(refreshed).toEqual({ "stable-workspace:one": 2, "stable-workspace:two": 1 })
    expect(refreshed).not.toHaveProperty("old-relay:one")
  })
})
