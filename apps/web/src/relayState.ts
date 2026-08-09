import type { AgentSummary, PermissionRequest, QuestionRequest, RelayInfo, SessionSummary } from "@remotty/protocol"

export type RoutedSession = SessionSummary & { workspaceRelayId: string; workspaceId: string }
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
export const stableWorkspaceKey = (relay: Pick<RelayInfo, "workspaceId" | "hostname" | "workspace">) => relay.workspaceId ?? `legacy:${relay.hostname}:${relay.workspace}`
export const relaySupportsSessionCreate = (relay: Pick<RelayInfo, "capabilities">) => relay.capabilities?.sessionCreate === 1
export const sessionRevisionKey = (relay: Pick<RelayInfo, "workspaceId" | "hostname" | "workspace">, sessionId: string) => `${stableWorkspaceKey(relay)}:${sessionId}`
export const bumpSessionRevisions = (
  current: Readonly<Record<string, number>>,
  relay: Pick<RelayInfo, "workspaceId" | "hostname" | "workspace">,
  sessionIds: Iterable<string>,
) => {
  const next = { ...current }
  for (const sessionId of sessionIds) {
    const key = sessionRevisionKey(relay, sessionId)
    next[key] = (next[key] ?? 0) + 1
  }
  return next
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
    .flatMap(([relayId, slice]) => slice.sessions.map((session) => ({ ...session, workspaceRelayId: relayId, workspaceId: stableWorkspaceKey(slice.relay) })))
    .sort((left, right) => {
      const recency = right.updatedAt - left.updatedAt
      if (recency) return recency
      const priority = (status: SessionSummary["status"]) => status === "busy" ? 2 : status === "retry" ? 1 : 0
      return priority(right.status) - priority(left.status)
    })
  const seenSessions = new Set<string>()
  const sessions = candidates.filter((session) => {
    const key = `${sliceWorkspaceKey(session.workspaceId, session.workspaceRelayId)}:${session.id}`
    if (seenSessions.has(key)) return false
    seenSessions.add(key)
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

const sliceWorkspaceKey = (workspaceId: string, _relayId: string) => workspaceId

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

export const resolveConnectedWorkspaceRelay = (
  workspaceKey: string,
  connectedRelayIds: Iterable<string>,
  slices: ReadonlyMap<string, RelaySlice>,
) => [...connectedRelayIds].find((relayId) => {
  const slice = slices.get(relayId)
  return slice && stableWorkspaceKey(slice.relay) === workspaceKey
})
