import type { PermissionRequest, QuestionRequest, SessionSummary } from "@remotty/protocol"

export function sessionHeaderStatus(
  session: Pick<SessionSummary, "id" | "status">,
  permission?: Pick<PermissionRequest, "sessionID">,
  question?: Pick<QuestionRequest, "sessionID">,
) {
  if (permission?.sessionID === session.id || question?.sessionID === session.id) {
    return { state: "needs-input", label: "Needs attention" } as const
  }
  const labels = { error: "Error", retry: "Retrying", busy: "Working", idle: "Ready" } as const
  return { state: session.status, label: labels[session.status] }
}
