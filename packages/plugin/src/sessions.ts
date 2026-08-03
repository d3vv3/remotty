export type SessionLike = {
  id?: unknown
  parentID?: unknown
  time?: unknown
}

type SessionRequest = { sessionID: string; targetSessionID?: string }

type SessionState = { type: "idle" | "busy" | "retry" }

const sessionTime = (session: SessionLike) => {
  const time = session.time as { updated?: unknown; created?: unknown } | undefined
  return Number(time?.updated ?? time?.created ?? 0)
}

export const selectOpenSessions = <T extends SessionLike>(
  sessions: T[],
  statuses: Record<string, SessionState>,
  activeSessionId?: string,
) => {
  const ordered = sessions
    .filter((session) => typeof session.parentID !== "string" || !session.parentID)
    .sort((left, right) => sessionTime(right) - sessionTime(left))
  const active = activeSessionId && ordered.some((session) => session.id === activeSessionId)
    ? activeSessionId
    : String(ordered[0]?.id ?? "") || undefined
  return {
    activeSessionId: active,
    sessions: ordered.filter((session) => {
      const status = statuses[String(session.id)]?.type
      return session.id === active || status === "busy" || status === "retry"
    }),
  }
}

export const rootSessionId = (sessionId: string, sessions: SessionLike[]) => {
  const parents = new Map(sessions.map((session) => [String(session.id ?? ""), session.parentID]))
  const seen = new Set<string>()
  let current = sessionId
  while (typeof parents.get(current) === "string" && parents.get(current) && !seen.has(current)) {
    seen.add(current)
    current = String(parents.get(current))
  }
  return current
}

export const routeSessionRequests = <T extends SessionRequest>(requests: T[], sessions: SessionLike[]) =>
  requests.map((request) => {
    const sessionID = rootSessionId(request.sessionID, sessions)
    return sessionID === request.sessionID
      ? request
      : { ...request, sessionID, targetSessionID: request.targetSessionID ?? request.sessionID }
  })
