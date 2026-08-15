import { base64urlEncode } from "@remotty/protocol"

export type PushSubscriptionLike = {
  endpoint: string
  expirationTime?: number | null
  getKey: (name: "p256dh" | "auth") => ArrayBuffer | null
}

const requiredKey = (subscription: PushSubscriptionLike, name: "p256dh" | "auth") => {
  const key = subscription.getKey(name)
  if (!key || key.byteLength === 0) throw new Error(`Push subscription is missing the ${name} key. Re-enable notifications.`)
  return key
}

export const serializePushSubscription = (subscription: PushSubscriptionLike | null | undefined) => {
  if (!subscription) throw new Error("The browser could not create a Push subscription. Select an active Web Push provider or UnifiedPush distributor, then try again.")
  if (!subscription.endpoint) throw new Error("Push subscription is missing an endpoint. Re-enable notifications.")

  return {
    endpoint: subscription.endpoint,
    expirationTime: subscription.expirationTime ?? null,
    keys: {
      p256dh: base64urlEncode(requiredKey(subscription, "p256dh")),
      auth: base64urlEncode(requiredKey(subscription, "auth")),
    },
  }
}
