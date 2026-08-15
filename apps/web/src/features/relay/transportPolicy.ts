export const reconnectDelay = (attempt: number, random = Math.random) => {
  const base = Math.min(30_000, 1_000 * 2 ** Math.max(0, attempt))
  return Math.round(base * (0.8 + random() * 0.4))
}

export const RESUME_SUSPENSION_MS = 5_000
export const HANDSHAKE_TIMEOUT_MS = 10_000

export const isTransportActivityStale = (lastActivityAt: number | undefined, now: number, threshold = RESUME_SUSPENSION_MS) =>
  lastActivityAt === undefined || now - lastActivityAt >= threshold

export const shouldReplaceTransportOnResume = ({
  socketOpen,
  now,
  hiddenAt,
  lastTransportActivity,
  persisted = false,
  online = false,
}: {
  socketOpen: boolean
  now: number
  hiddenAt?: number
  lastTransportActivity?: number
  persisted?: boolean
  online?: boolean
}) => {
  if (!socketOpen || online) return true
  if (persisted) return isTransportActivityStale(lastTransportActivity, now)
  if (hiddenAt !== undefined) return now - hiddenAt >= RESUME_SUSPENSION_MS
  return false
}

export const shouldReconnectTransportOnResume = (socketConnecting: boolean, resume: Parameters<typeof shouldReplaceTransportOnResume>[0]) =>
  !socketConnecting && shouldReplaceTransportOnResume(resume)

export const shouldExpireHandshakeWatchdog = (generation: number, currentGeneration: number, authenticated: boolean) =>
  generation === currentGeneration && !authenticated

export const hasSequenceGap = (current: number | undefined, next: number) =>
  current !== undefined && next > current + 1

export const readOnlyCommand = (type: string) =>
  ["snapshot.request", "session.messages", "session.todos", "session.diff", "workspace.diff", "workspace.diff.patch", "relay.ping"].includes(type)

export const retryPlan = (now: number, deadline: number, attempts: number) => attempts < 2 && now < deadline
export const requestInactivityMs = (type: string) => type === "relay.ping" ? 8_000 : ["session.messages", "workspace.diff", "workspace.diff.patch"].includes(type) ? 20_000 : 15_000
