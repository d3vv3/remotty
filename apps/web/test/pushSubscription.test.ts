import { describe, expect, it } from "vitest"
import { serializePushSubscription, type PushSubscriptionLike } from "../src/pushSubscription"

const key = (bytes: number[]) => Uint8Array.from(bytes).buffer

const subscription = (overrides: Partial<PushSubscriptionLike> = {}): PushSubscriptionLike => ({
  endpoint: "https://push.example/subscription",
  expirationTime: null,
  getKey: (name) => name === "p256dh" ? key([0xfb, 0xef, 0xff]) : key([0, 1, 2]),
  ...overrides,
})

describe("serializePushSubscription", () => {
  it("handles null from WebLibre's UnifiedPush subscribe-error bridge", () => {
    // WebLibre calls onSubscribe(null) when a UnifiedPush subscription fails.
    expect(() => serializePushSubscription(null)).toThrow("The browser could not create a Push subscription. Select an active Web Push provider or UnifiedPush distributor, then try again.")
  })

  it("handles an undefined browser subscription", () => {
    expect(() => serializePushSubscription(undefined)).toThrow("The browser could not create a Push subscription. Select an active Web Push provider or UnifiedPush distributor, then try again.")
  })

  it("serializes Web Push fields without requiring toJSON", () => {
    expect(serializePushSubscription(subscription())).toEqual({
      endpoint: "https://push.example/subscription",
      expirationTime: null,
      keys: { p256dh: "--__", auth: "AAEC" },
    })
  })

  it("does not call a throwing toJSON implementation", () => {
    const value = Object.assign(subscription({ expirationTime: 1_725_000_000_000 }), {
      toJSON: () => { throw new Error("toJSON must not be called") },
    })

    expect(serializePushSubscription(value)).toEqual({
      endpoint: "https://push.example/subscription",
      expirationTime: 1_725_000_000_000,
      keys: { p256dh: "--__", auth: "AAEC" },
    })
  })

  it.each([
    ["endpoint", subscription({ endpoint: "" }), "Push subscription is missing an endpoint. Re-enable notifications."],
    ["p256dh", subscription({ getKey: (name) => name === "p256dh" ? null : key([1]) }), "Push subscription is missing the p256dh key. Re-enable notifications."],
    ["auth", subscription({ getKey: (name) => name === "auth" ? null : key([1]) }), "Push subscription is missing the auth key. Re-enable notifications."],
  ])("rejects a missing %s", (_field, value, message) => {
    expect(() => serializePushSubscription(value)).toThrow(message)
  })
})
