export type SessionLike = {
  id?: unknown
  parentID?: unknown
  directory?: unknown
  time?: unknown
}

type SessionRequest = { sessionID: string; targetSessionID?: string }

const sessionTime = (session: SessionLike) => {
  const time = session.time as { updated?: unknown; created?: unknown } | undefined
  return Number(time?.updated ?? time?.created ?? 0)
}

export const includeActiveSession = <T extends SessionLike>(sessions: T[], knownSessions: T[], activeSessionId?: string) => {
  if (!activeSessionId || sessions.some((session) => session.id === activeSessionId)) return sessions
  const active = knownSessions.find((session) => session.id === activeSessionId)
  return active ? [active, ...sessions] : sessions
}

export const selectOpenSessions = <T extends SessionLike>(
  sessions: T[],
  activeSessionId?: string,
) => {
  const ordered = sessions
    .filter((session) => typeof session.parentID !== "string" || !session.parentID)
    .sort((left, right) => sessionTime(right) - sessionTime(left))
  const active = activeSessionId && ordered.some((session) => session.id === activeSessionId)
    ? activeSessionId
    : undefined
  return {
    activeSessionId: active,
    sessions: ordered,
  }
}

export const rootSessionId = (sessionId: string, sessions: SessionLike[]) => {
  return rootSessionIdFromParents(sessionId, new Map(sessions.map((session) => [String(session.id ?? ""), session.parentID])))
}

const rootSessionIdFromParents = (sessionId: string, parents: ReadonlyMap<string, unknown>) => {
  const seen = new Set<string>()
  let current = sessionId
  while (typeof parents.get(current) === "string" && parents.get(current) && !seen.has(current)) {
    seen.add(current)
    current = String(parents.get(current))
  }
  return current
}

export const sessionDirectory = (sessionId: string, sessions: SessionLike[], fallback: string) => {
  const rootId = rootSessionId(sessionId, sessions)
  const directory = sessions.find((session) => session.id === rootId)?.directory
  return typeof directory === "string" && directory ? directory : fallback
}

export const routeSessionRequests = <T extends SessionRequest>(requests: T[], sessions: SessionLike[]) =>
  {
    const parents = new Map(sessions.map((session) => [String(session.id ?? ""), session.parentID]))
    return requests.map((request) => {
    const sessionID = rootSessionIdFromParents(request.sessionID, parents)
    return sessionID === request.sessionID
      ? request
      : { ...request, sessionID, targetSessionID: request.targetSessionID ?? request.sessionID }
    })
  }

export type SubagentLike = SessionLike & { title?: unknown; agent?: unknown; summary?: unknown }

/** Select only valid descendants of transmitted roots, preserving their direct parent. */
export const selectSubagents = <T extends SubagentLike>(roots: T[], hierarchy: T[]) => {
  const rootIds = new Set(roots.map((session) => String(session.id ?? "")).filter(Boolean))
  const byId = new Map(hierarchy.map((session) => [String(session.id ?? ""), session]))
  const parents = new Map(hierarchy.map((session) => [String(session.id ?? ""), session.parentID]))
  const result: Array<T & { parentSessionId: string; rootSessionId: string }> = []
  for (const session of hierarchy) {
    const id = String(session.id ?? "")
    const parentSessionId = typeof session.parentID === "string" ? session.parentID : ""
    if (!id || rootIds.has(id) || !parentSessionId || !byId.has(parentSessionId)) continue
    const rootSessionId = rootSessionIdFromParents(id, parents)
    if (rootSessionId === id || !rootIds.has(rootSessionId)) continue
    result.push({ ...session, parentSessionId, rootSessionId })
  }
  return result
}
