export type DeliveryState = "sending" | "accepted" | "uncertain" | "failed"

type DeliveryMessage = { info: { id?: string; role?: string; parentID?: string; delivery?: DeliveryState } }

export const deliveryBadgeForMessage = (message: DeliveryMessage, messages: readonly DeliveryMessage[] = []): DeliveryState | undefined => {
  const delivery = message.info.delivery
  if (delivery && delivery !== "accepted") return delivery
  if (message.info.role !== "user" || !message.info.id) return delivery
  const index = messages.indexOf(message)
  // A parent link proves processing has begun, even for an empty or internal
  // assistant message. Older journals without links use their ordered bylines.
  let processedThrough = -1
  for (const [assistantIndex, candidate] of messages.entries()) {
    if (candidate.info.role !== "assistant") continue
    if (candidate.info.parentID === message.info.id) return undefined
    const parentIndex = candidate.info.parentID
      ? messages.findIndex((item) => item.info.id === candidate.info.parentID)
      : assistantIndex - 1
    processedThrough = Math.max(processedThrough, parentIndex)
  }
  if (delivery === "accepted") return delivery
  // Only the unanswered tail is queued. Do not label old unanswered/aborted
  // prompts in history, or infer acceptance without a canonical journal entry.
  return index > processedThrough ? "accepted" : undefined
}

export const deliveryLabel = (delivery: DeliveryState): string => {
  if (delivery === "accepted") return "Queued"
  if (delivery === "uncertain") return "Delivery uncertain"
  if (delivery === "sending") return "Sending"
  return "Delivery failed"
}
