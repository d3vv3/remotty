import type { AgentSummary, PermissionRequest, QuestionRequest, RelayInfo, SessionSummary } from "@remotty/protocol"

export type RoutedSession = SessionSummary & { workspaceRelayId: string }
export type RoutedPermission = PermissionRequest & { workspaceRelayId: string }
export type RoutedQuestion = QuestionRequest & { workspaceRelayId: string }
export type RoutedAgent = AgentSummary & { workspaceRelayId: string }
export type RelaySlice = {
  relay: RelayInfo
  sessions: SessionSummary[]
  agents: AgentSummary[]
  permissions: PermissionRequest[]
  questions: QuestionRequest[]
  sequence?: number
}

export type AggregatedRelayState = {
  relay?: RelayInfo
  relays: RelayInfo[]
  sessions: RoutedSession[]
  agents: RoutedAgent[]
  permissions: RoutedPermission[]
  questions: RoutedQuestion[]
  sessionRelays: Map<string, string>
}

export const acceptsRelayPosition = (
  current: Pick<RelaySlice, "relay" | "sequence"> | undefined,
  nextRelay: RelayInfo,
  nextSequence: number | undefined,
) => {
  if (!nextRelay.instanceId || nextRelay.instanceStartedAt === undefined || nextSequence === undefined) return false
  if (!current) return true
  if ((current.relay.instanceStartedAt ?? -1) > nextRelay.instanceStartedAt) return false
  return current.relay.instanceId !== nextRelay.instanceId || nextSequence > (current.sequence ?? -1)
}

export const aggregateRelaySlices = (slices: Iterable<[string, RelaySlice]>): AggregatedRelayState => {
  const entries = [...slices]
  const relays = entries.map(([, slice]) => slice.relay)
  const candidates = entries
    .flatMap(([relayId, slice]) => slice.sessions.map((session) => ({ ...session, workspaceRelayId: relayId })))
    .sort((left, right) => {
      const recency = right.updatedAt - left.updatedAt
      if (recency) return recency
      const priority = (status: SessionSummary["status"]) => status === "busy" ? 2 : status === "retry" ? 1 : 0
      return priority(right.status) - priority(left.status)
    })
  const seenSessions = new Set<string>()
  const sessions = candidates.filter((session) => {
    if (seenSessions.has(session.id)) return false
    seenSessions.add(session.id)
    return true
  })
  const sessionRelays = new Map<string, string>()
  for (const session of sessions) {
    if (!sessionRelays.has(session.id)) sessionRelays.set(session.id, session.workspaceRelayId)
  }
  const agents = entries.flatMap(([relayId, slice]) =>
    slice.agents
      .filter((agent) => agent.mode === "primary")
      .map((agent) => ({ ...agent, workspaceRelayId: relayId })))
  return {
    relay: relays[0],
    relays,
    sessions,
    agents,
    permissions: entries.flatMap(([relayId, slice]) =>
      slice.permissions.map((permission) => ({ ...permission, workspaceRelayId: relayId }))),
    questions: entries.flatMap(([relayId, slice]) =>
      slice.questions.map((question) => ({ ...question, workspaceRelayId: relayId }))),
    sessionRelays,
  }
}

export const commandRelayId = (
  command: { type: string; sessionId?: string },
  connectedRelayIds: Iterable<string>,
  sessionRelays: ReadonlyMap<string, string>,
) => {
  if (command.sessionId) return sessionRelays.get(command.sessionId)
  if (command.type === "snapshot.request") return undefined
  const connected = [...connectedRelayIds]
  return connected.length === 1 ? connected[0] : undefined
}
