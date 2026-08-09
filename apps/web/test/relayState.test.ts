import { describe, expect, it } from "vitest"
import { acceptsRelayPosition, aggregateRelaySlices, commandRelayId, relaySupportsSessionCreate, resolveConnectedWorkspaceRelay, stableWorkspaceKey, type RelaySlice } from "../src/relayState"

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
})

describe("relay snapshot aggregation and routing", () => {
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
})
