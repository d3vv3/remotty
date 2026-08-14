type JsonObject = Record<string, unknown>

export type CompletionState = {
  busy: Set<string>
  notified: Set<string>
}

export const completionSessionForEvent = (
  eventType: string,
  properties: JsonObject,
  state: CompletionState,
) => {
  const sessionId = typeof properties.sessionID === "string" ? properties.sessionID : undefined
  if (!sessionId) return

  if (eventType === "session.status") {
    const status = properties.status as JsonObject | undefined
    if (status?.type === "busy" || status?.type === "retry") {
      state.busy.add(sessionId)
      state.notified.delete(sessionId)
      return
    }
    if (status?.type !== "idle" || !state.busy.has(sessionId)) return
  } else if (eventType !== "session.idle") {
    return
  }

  state.busy.delete(sessionId)
  if (state.notified.has(sessionId)) return
  state.notified.add(sessionId)
  return sessionId
}

export const completionNotification = (relayId: string, sessionId: string, sessionTitle?: string, workspaceId?: string) => ({
  type: "notification.show" as const,
  title: "Agent finished",
  body: sessionTitle || "OpenCode is ready for your next instruction.",
  tag: `${relayId}:finished-${sessionId}`,
  actions: [],
  openApp: true,
  data: { sessionId, workspaceRelayId: relayId, ...(workspaceId ? { workspaceId } : {}) },
})

export const questionNotification = (
  relayId: string,
  workspaceId: string,
  questionId: string,
  sessionId: string,
  question?: string,
) => ({
  type: "notification.show" as const,
  title: "Question",
  body: question ?? "Open the app to answer",
  tag: `${relayId}:question-${questionId}`,
  actions: [],
  openApp: true,
  data: { sessionId, questionId, workspaceRelayId: relayId, workspaceId },
})

export const shouldNotifySessionCompletion = (session: { parentID?: unknown } | undefined) =>
  Boolean(session && (typeof session.parentID !== "string" || !session.parentID))
