type SessionLike = {
  id?: unknown
  time?: unknown
}

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
  const ordered = [...sessions].sort((left, right) => sessionTime(right) - sessionTime(left))
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
