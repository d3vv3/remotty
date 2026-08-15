export const mergeByMessageId = <T extends { info: { id: string; time?: { created?: number } } }>(current: T[], incoming: T[]) => {
  const merged = new Map(current.map((message) => [message.info.id, message]))
  for (const message of incoming) {
    const existing = merged.get(message.info.id)
    if (!existing) { merged.set(message.info.id, message); continue }
    const info = { ...existing.info, ...message.info } as typeof message.info & { delivery?: unknown }
    if (!("delivery" in message.info)) delete info.delivery
    merged.set(message.info.id, { ...existing, ...message, info })
  }
  return [...merged.values()].sort((left, right) => (left.info.time?.created ?? 0) - (right.info.time?.created ?? 0))
}

export const mergeCachedMessages = <T extends { info: { id: string; time?: { created?: number } } }>(live: T[], cached: T[]) =>
  mergeByMessageId(cached, live)

export const reconcileCanonicalMessages = <T extends { info: { id: string; time?: { created?: number }; delivery?: unknown } }>(local: T[], canonical: T[]) => {
  const localById = new Map(local.map((message) => [message.info.id, message]))
  const canonicalIds = new Set(canonical.map((message) => message.info.id))
  const reconciled = canonical.map((message) => {
    const existing = localById.get(message.info.id)
    if (!existing) return message
    const info = { ...existing.info, ...message.info } as T["info"] & { delivery?: unknown }
    delete info.delivery
    return { ...existing, ...message, info }
  })
  return [...reconciled, ...local.filter((message) => !canonicalIds.has(message.info.id) && message.info.delivery !== undefined)]
}

export const promptDeliveryState = (message: string): "uncertain" | "failed" => /Connection interrupted|relay did not respond|Relay is offline|workspace relay disconnected|socket (?:closed|replaced)|transport (?:closed|lost)/i.test(message) ? "uncertain" : "failed"
