import { describe, expect, it } from "vitest"
import { clearNotificationPromptSeen, markNotificationPromptSeen, notificationPromptWasSeen, shouldOfferPushNotifications } from "../src/features/notifications/notificationPrompt"

const ready = {
  connected: true,
  hasRelay: true,
  enabled: false,
  supported: true,
  permission: "default" as const,
  seen: false,
}

describe("shouldOfferPushNotifications", () => {
  it("offers Push after the first relay screen loads", () => {
    expect(shouldOfferPushNotifications(ready)).toBe(true)
  })

  it("does not offer Push before enrollment or after handling the prompt", () => {
    expect(shouldOfferPushNotifications({ ...ready, connected: false })).toBe(false)
    expect(shouldOfferPushNotifications({ ...ready, hasRelay: false })).toBe(false)
    expect(shouldOfferPushNotifications({ ...ready, enabled: true })).toBe(false)
    expect(shouldOfferPushNotifications({ ...ready, seen: true })).toBe(false)
  })

  it("does not offer Push when unsupported or blocked", () => {
    expect(shouldOfferPushNotifications({ ...ready, supported: false, permission: "unsupported" })).toBe(false)
    expect(shouldOfferPushNotifications({ ...ready, permission: "denied" })).toBe(false)
  })

  it("continues when prompt-seen storage is unavailable", () => {
    expect(notificationPromptWasSeen()).toBe(false)
    expect(() => markNotificationPromptSeen()).not.toThrow()
    expect(() => clearNotificationPromptSeen()).not.toThrow()
  })
})
