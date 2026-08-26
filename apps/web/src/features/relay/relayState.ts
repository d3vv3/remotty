import type { AgentSummary, AgentTheme, PermissionRequest, QuestionRequest, RelayInfo, SessionSummary, SubagentSummary } from "@remotty/protocol"

export type RoutedSession = SessionSummary & { workspaceRelayId: string; workspaceId: string }
export type RoutedPermission = PermissionRequest & { workspaceRelayId: string }
export type RoutedQuestion = QuestionRequest & { workspaceRelayId: string }
export type RoutedAgent = AgentSummary & { workspaceRelayId: string; agentTheme?: AgentTheme }
export type RoutedSubagent = SubagentSummary & { workspaceRelayId: string; workspaceId: string }
export type RelaySlice = {
  relay: RelayInfo
  sessions: SessionSummary[]
  subagents: SubagentSummary[]
  agents: AgentSummary[]
  agentTheme?: AgentTheme
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
  subagents: RoutedSubagent[]
  subagentsByRoot: Map<string, RoutedSubagent[]>
  sessionRelays: Map<string, string>
}
export const stableWorkspaceKey = (relay: Pick<RelayInfo, "workspaceId" | "hostname" | "workspace">) => relay.workspaceId ?? `legacy:${relay.hostname}:${relay.workspace}`
export const relaySupportsSessionCreate = (relay: Pick<RelayInfo, "capabilities">) => relay.capabilities?.sessionCreate === 1
export const sessionRevisionKey = (relay: Pick<RelayInfo, "workspaceId" | "hostname" | "workspace">, sessionId: string) => `${stableWorkspaceKey(relay)}:${sessionId}`
export const workspaceSessionKey = (workspaceId: string, sessionId: string) => `${workspaceId}:${sessionId}`
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
export type ResourceRevisions = Record<string, { messages: number; todos: number; diffs: number }>
/** Cached snapshots predate subagent support; normalize before aggregation. */
export const normalizeRelaySlice = (slice: Omit<RelaySlice, "subagents"> & { subagents?: SubagentSummary[] }): RelaySlice => ({ ...slice, subagents: slice.subagents ?? [] })
export const bumpResourceRevisions = (current: ResourceRevisions, relay: Pick<RelayInfo, "workspaceId" | "hostname" | "workspace">, sessionIds: Iterable<string>, resources: Array<keyof ResourceRevisions[string]>) => {
  const next = { ...current }
  for (const id of sessionIds) {
    const key = sessionRevisionKey(relay, id)
    const prior = next[key] ?? { messages: 0, todos: 0, diffs: 0 }
    next[key] = { ...prior, ...Object.fromEntries(resources.map((resource) => [resource, prior[resource] + 1])) }
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

/** Rejects a stale relay identity before it can supersede another slice in its workspace. */
export const acceptsWorkspaceRelayPosition = (
  slices: ReadonlyMap<string, RelaySlice>,
  connectedRelayIds: Iterable<string>,
  relayId: string,
  nextRelay: RelayInfo,
  nextSequence: number | undefined,
) => {
  if (!nextRelay.instanceId || nextRelay.instanceStartedAt === undefined || nextSequence === undefined) return false
  const workspace = stableWorkspaceKey(nextRelay)
  const nextInstanceStartedAt = nextRelay.instanceStartedAt
  const connected = new Set(connectedRelayIds)
  return [...slices].every(([currentRelayId, current]) => {
    if (currentRelayId === relayId || stableWorkspaceKey(current.relay) !== workspace) return true
    const currentInstanceStartedAt = current.relay.instanceStartedAt ?? -1
    if (currentInstanceStartedAt > nextInstanceStartedAt) return false
    if (currentInstanceStartedAt < nextInstanceStartedAt) return true
    if (current.relay.instanceId === nextRelay.instanceId) return nextSequence > (current.sequence ?? -1)
    return !connected.has(currentRelayId)
  })
}

export type RelayHelloHandoff =
  | { accepted: false }
  | { accepted: true; slices: Map<string, RelaySlice>; superseded: string[] }

/** Transfers cached workspace summaries to a new relay identity until its snapshot arrives. */
export const handoffRelayHello = (
  slices: ReadonlyMap<string, RelaySlice>,
  connectedRelayIds: Iterable<string>,
  relayId: string,
  relay: RelayInfo,
  sequence: number,
): RelayHelloHandoff => {
  const workspace = stableWorkspaceKey(relay)
  const prior = [...slices].filter(([, slice]) => stableWorkspaceKey(slice.relay) === workspace)
  if (!acceptsWorkspaceRelayPosition(slices, connectedRelayIds, relayId, relay, sequence)) return { accepted: false }

  const newestById = <T extends { id: string; updatedAt: number }>(items: T[]) => {
    const seen = new Set<string>()
    return [...items].sort((left, right) => right.updatedAt - left.updatedAt).filter((item) => {
      if (seen.has(item.id)) return false
      seen.add(item.id)
      return true
    })
  }
  const next = new Map(slices)
  const superseded = prior.map(([id]) => id).filter((id) => id !== relayId)
  for (const id of superseded) next.delete(id)
  next.set(relayId, {
    relay,
    sessions: newestById(prior.flatMap(([, slice]) => slice.sessions)),
    subagents: newestById(prior.flatMap(([, slice]) => slice.subagents)),
    agents: [],
    agentTheme: undefined,
    permissions: [],
    questions: [],
    sequence,
  })
  return { accepted: true, slices: next, superseded }
}

export const aggregateRelaySlices = (
  slices: Iterable<[string, RelaySlice]>,
  connectedRelayIds?: Iterable<string>,
): AggregatedRelayState => {
  const entries = [...slices]
  const connected = new Set(connectedRelayIds ?? entries.map(([relayId]) => relayId))
  const relays = entries.map(([, slice]) => slice.relay)
  const activeEntries = entries.filter(([relayId]) => connected.has(relayId))
  const activeWorkspaces = new Set(activeEntries.map(([, slice]) => stableWorkspaceKey(slice.relay)))
  const visibleEntries = [
    ...activeEntries,
    ...entries.filter(([relayId, slice]) => !connected.has(relayId) && !activeWorkspaces.has(stableWorkspaceKey(slice.relay))),
  ]
  const candidates = visibleEntries
    .flatMap(([relayId, slice]) => slice.sessions.map((session) => ({ ...session, workspaceRelayId: relayId, workspaceId: stableWorkspaceKey(slice.relay) })))
    .sort((left, right) => {
      const recency = right.updatedAt - left.updatedAt
      if (recency) return recency
      const priority = (status: SessionSummary["status"]) => status === "busy" ? 2 : status === "retry" ? 1 : 0
      return priority(right.status) - priority(left.status)
    })
  const seenSessions = new Set<string>()
  const sessions = candidates.filter((session) => {
    const key = workspaceSessionKey(sliceWorkspaceKey(session.workspaceId, session.workspaceRelayId), session.id)
    if (seenSessions.has(key)) return false
    seenSessions.add(key)
    return true
  })
  const sessionRelays = new Map<string, string>()
  for (const session of sessions) {
    sessionRelays.set(workspaceSessionKey(session.workspaceId, session.id), session.workspaceRelayId)
    if (!sessionRelays.has(session.id)) sessionRelays.set(session.id, session.workspaceRelayId)
  }
  const subagents = visibleEntries.flatMap(([relayId, slice]) => slice.subagents.map((session) => ({ ...session, workspaceRelayId: relayId, workspaceId: stableWorkspaceKey(slice.relay) })))
  const seenSubagents = new Set<string>()
  const uniqueSubagents = subagents.filter((session) => {
    const key = workspaceSessionKey(session.workspaceId, session.id)
    if (seenSubagents.has(key)) return false
    seenSubagents.add(key)
    sessionRelays.set(workspaceSessionKey(session.workspaceId, session.id), session.workspaceRelayId)
    if (!sessionRelays.has(session.id)) sessionRelays.set(session.id, session.workspaceRelayId)
    return true
  })
  const subagentsByRoot = new Map<string, RoutedSubagent[]>()
  for (const subagent of uniqueSubagents) {
    const rootKey = workspaceSessionKey(subagent.workspaceId, subagent.rootSessionId)
    const items = subagentsByRoot.get(rootKey) ?? []
    items.push(subagent)
    subagentsByRoot.set(rootKey, items)
  }
  for (const items of subagentsByRoot.values()) items.sort((left, right) => right.updatedAt - left.updatedAt)
  const agents = activeEntries.flatMap(([relayId, slice]) =>
    slice.agents
      .filter((agent) => agent.mode === "primary" || agent.mode === "all")
      .map((agent) => ({ ...agent, workspaceRelayId: relayId, agentTheme: slice.agentTheme })))
  return {
    relay: activeEntries[0]?.[1].relay ?? relays[0],
    relays,
    sessions,
    agents,
    permissions: activeEntries.flatMap(([relayId, slice]) =>
      slice.permissions.map((permission) => ({ ...permission, workspaceRelayId: relayId }))),
    questions: activeEntries.flatMap(([relayId, slice]) =>
      slice.questions.map((question) => ({ ...question, workspaceRelayId: relayId }))),
    subagents: uniqueSubagents,
    subagentsByRoot,
    sessionRelays,
  }
}

const sliceWorkspaceKey = (workspaceId: string, _relayId: string) => workspaceId

export const commandRelayId = (
  command: { type: string; sessionId?: string; workspaceId?: string },
  connectedRelayIds: Iterable<string>,
  sessionRelays: ReadonlyMap<string, string>,
) => {
  const connected = new Set(connectedRelayIds)
  if (command.sessionId) {
    const relayId = command.workspaceId ? sessionRelays.get(workspaceSessionKey(command.workspaceId, command.sessionId)) : sessionRelays.get(command.sessionId)
    return relayId && connected.has(relayId) ? relayId : undefined
  }
  if (command.type === "snapshot.request") return undefined
  return connected.size === 1 ? connected.values().next().value : undefined
}

export const resolveConnectedWorkspaceRelay = (
  workspaceKey: string,
  connectedRelayIds: Iterable<string>,
  slices: ReadonlyMap<string, RelaySlice>,
) => [...connectedRelayIds].find((relayId) => {
  const slice = slices.get(relayId)
  return slice && stableWorkspaceKey(slice.relay) === workspaceKey
})
