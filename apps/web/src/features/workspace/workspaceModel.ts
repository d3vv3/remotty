import type { SessionSummary } from "@remotty/protocol"

export const SESSION_LIST_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1_000

export const isSessionVisibleInList = (session: Pick<SessionSummary, "updatedAt">, now: number) =>
  session.updatedAt >= now - SESSION_LIST_MAX_AGE_MS

export const sessionKey = (session: SessionSummary & { workspaceRelayId?: string; workspaceId?: string }) =>
  `${session.workspaceId ?? session.workspaceRelayId ?? ""}:${session.id}`

export const folderName = (directory: string) => directory.split(/[\\/]/).filter(Boolean).at(-1) ?? directory

export function sessionListPriority(session: Pick<SessionSummary, "status">, needsInput: boolean, offline: boolean) {
  if (offline) return 2
  if (needsInput) return 0
  return session.status === "busy" || session.status === "retry" ? 1 : 2
}

export function compareSessionListEntries(
  left: SessionSummary & { workspaceId?: string; workspaceRelayId?: string },
  right: SessionSummary & { workspaceId?: string; workspaceRelayId?: string },
  priority: (session: typeof left) => number,
) {
  return priority(left) - priority(right) || right.updatedAt - left.updatedAt || sessionKey(left).localeCompare(sessionKey(right))
}

export const relativeTime = (time: number) => {
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1_000))
  if (seconds < 60) return "now"
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h`
  return `${Math.floor(seconds / 86_400)}d`
}
