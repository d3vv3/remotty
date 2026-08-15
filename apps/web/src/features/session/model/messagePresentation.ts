export type DeliveryState = "sending" | "accepted" | "uncertain" | "failed"

export const deliveryBadgeForMessage = (message: { info: { role?: string; delivery?: DeliveryState } }): DeliveryState | undefined => message.info.delivery

export const deliveryLabel = (delivery: DeliveryState): string => {
  if (delivery === "accepted") return "Accepted by OpenCode"
  if (delivery === "uncertain") return "Delivery uncertain"
  if (delivery === "sending") return "Sending"
  return "Delivery failed"
}
