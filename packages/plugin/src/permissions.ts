import type { PermissionRequest } from "@remotty/protocol"

type JsonObject = Record<string, unknown>
export type PermissionReplyDialect = NonNullable<PermissionRequest["replyDialect"]>
export type PermissionReplyCommand = {
  sessionId: string
  permissionId: string
  response: "once" | "always" | "reject"
  replyDialect?: PermissionReplyDialect
}
type PermissionReplyRequest =
  | { url: string; body: { reply: PermissionReplyCommand["response"] } }
  | { path: { id: string; permissionID: string }; body: { response: PermissionReplyCommand["response"] } }

const object = (value: unknown): JsonObject | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : undefined

const text = (value: unknown) => typeof value === "string" && value ? value : undefined
const textArray = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
const metadata = (value: unknown) => object(value) ?? {}

/** Converts OpenCode's permission event versions to the encrypted relay protocol shape. */
export const normalizePermissionRequest = (value: unknown): PermissionRequest | undefined => {
  const raw = object(value)
  const id = text(raw?.id)
  const sessionID = text(raw?.sessionID)
  if (!raw || !id || !sessionID) return undefined

  if (text(raw.action) && Array.isArray(raw.resources)) {
    const patterns = textArray(raw.resources)
    return {
      id,
      sessionID,
      permission: text(raw.action)!,
      patterns,
      metadata: metadata(raw.metadata),
      always: textArray(raw.save),
      replyDialect: "v2",
    }
  }

  const permission = text(raw.permission) ?? text(raw.type)
  if (!permission) return undefined
  const patterns = Array.isArray(raw.patterns)
    ? textArray(raw.patterns)
    : Array.isArray(raw.pattern)
      ? textArray(raw.pattern)
      : text(raw.pattern) ? [text(raw.pattern)!] : []
  return {
    id,
    sessionID,
    permission,
    patterns,
    metadata: metadata(raw.metadata),
    always: textArray(raw.always),
    replyDialect: "standard",
  }
}

export const normalizePermissionRequests = (value: unknown, warn?: () => void) => {
  const raw = object(value)
  const requests = Array.isArray(value) ? value : Array.isArray(raw?.data) ? raw.data : undefined
  if (!requests) {
    if (value !== undefined) warn?.()
    return []
  }
  const normalized = new Map<string, PermissionRequest>()
  for (const item of requests) {
    const request = normalizePermissionRequest(item)
    if (!request) {
      warn?.()
      continue
    }
    normalized.set(request.id, request)
  }
  return [...normalized.values()]
}

export const permissionReplyId = (value: unknown) => {
  const raw = object(value)
  return text(raw?.id) ?? text(raw?.requestID) ?? text(raw?.permissionID)
}

export const permissionReplyRequest = (command: PermissionReplyCommand): PermissionReplyRequest => command.replyDialect === "v2"
  ? {
      url: `/api/session/${encodeURIComponent(command.sessionId)}/permission/${encodeURIComponent(command.permissionId)}/reply`,
      body: { reply: command.response },
    }
  : { path: { id: command.sessionId, permissionID: command.permissionId }, body: { response: command.response } }

export const permissionNotification = (
  relayId: string,
  workspaceId: string,
  request: PermissionRequest,
) => ({
  type: "notification.show" as const,
  title: "Permission required",
  body: request.patterns[0] ?? request.permission,
  tag: `${relayId}:permission-${request.id}`,
  actions: [
    { action: "reject", title: "Reject" },
    { action: "once", title: "Allow once" },
    { action: "always", title: "Always allow" },
  ],
  data: {
    sessionId: request.sessionID,
    permissionId: request.id,
    workspaceRelayId: relayId,
    workspaceId,
    ...(request.targetSessionID ? { targetSessionId: request.targetSessionID } : {}),
    ...(request.replyDialect ? { replyDialect: request.replyDialect } : {}),
  },
})
