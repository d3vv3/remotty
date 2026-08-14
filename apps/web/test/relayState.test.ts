import { describe, expect, it } from "vitest"
import { acceptsRelayPosition, aggregateRelaySlices, bumpSessionRevisions, commandRelayId, normalizeRelaySlice, relaySupportsSessionCreate, resolveConnectedWorkspaceRelay, sessionRevisionKey, stableWorkspaceKey, visibleSubagents, workspaceSessionKey, type RelaySlice } from "../src/relayState"

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

  it("does not expose subagent-capable agents from older relays", () => {
    const current = slice("relay-a", "session-a", 1)
    current.agents.push({ name: "explore", mode: "all" })

    expect(aggregateRelaySlices(new Map([["relay-a", current]])).agents.map((agent) => agent.name)).toEqual(["build"])
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
