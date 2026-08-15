export type ConnectionState = "connecting" | "online" | "unstable" | "offline" | "disconnected"
export type RelayHealth = { lastContact?: number; rtt?: number; timedOut?: boolean }
export type ConnectionTone = "online" | "unstable" | "offline"
export type ConnectionPresentation = { state: ConnectionTone | "connecting"; label: string; tone: ConnectionTone; hasTimedOutRelay: boolean }
export type ConnectionRowPresentation = { state: ConnectionTone; label: string; detail: string }

export const exactConnectionTime = (time: number, now: number) => {
  const elapsed = Math.max(0, now - time)
  if (elapsed < 1_000) return `${Math.floor(elapsed)} ms ago`
  const seconds = Math.floor(elapsed / 1_000)
  return `${seconds} ${seconds === 1 ? "second" : "seconds"} ago`
}

export const healthSummary = (connected: Iterable<string>, health: Record<string, RelayHealth>) => [...connected].some((relayId) => health[relayId]?.timedOut)

export const effectiveConnectionPresentation = (
  state: ConnectionState,
  connectedRelayIds: Iterable<string>,
  relayCount: number,
  health: Record<string, RelayHealth>,
): ConnectionPresentation => {
  const hasTimedOutRelay = healthSummary(connectedRelayIds, health)
  if (state === "online" && relayCount && !hasTimedOutRelay) return { state: "online", label: "Live", tone: "online", hasTimedOutRelay }
  if (state === "connecting") return { state: "connecting", label: "Connecting", tone: "offline", hasTimedOutRelay }
  if (state === "unstable" || hasTimedOutRelay) return { state: "unstable", label: "Unstable", tone: "unstable", hasTimedOutRelay }
  return { state: "offline", label: "Offline", tone: "offline", hasTimedOutRelay }
}

export const relayConnectionPresentation = (connected: boolean, health: RelayHealth | undefined, now: number): ConnectionRowPresentation => {
  if (!connected) return { state: "offline", label: "Offline", detail: health?.rtt !== undefined ? `${health.rtt} ms` : health?.lastContact ? `Last contact ${exactConnectionTime(health.lastContact, now)}` : "" }
  if (health?.timedOut) return { state: "unstable", label: "Unstable", detail: health.lastContact ? `Last contact ${exactConnectionTime(health.lastContact, now)}` : "" }
  return { state: "online", label: "Connected", detail: health?.rtt !== undefined ? `${health.rtt} ms` : health?.lastContact ? `Last contact ${exactConnectionTime(health.lastContact, now)}` : "" }
}

export const serviceConnectionPresentation = (serviceConnected: boolean, overall: ConnectionPresentation): ConnectionRowPresentation => {
  if (!serviceConnected) return { state: "offline", label: "Unreachable", detail: "" }
  if (overall.state === "unstable" && !overall.hasTimedOutRelay) return { state: "unstable", label: "Unstable", detail: "" }
  return { state: "online", label: "Connected", detail: "" }
}

export const connectionLabel = (state: ConnectionState, relayCount: number, timedOut: boolean) =>
  effectiveConnectionPresentation(state, timedOut ? ["timed-out"] : [], relayCount, timedOut ? { "timed-out": { timedOut } } : {}).label
