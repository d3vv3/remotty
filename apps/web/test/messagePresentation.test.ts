import { describe, expect, it } from "vitest"
import { deliveryBadgeForMessage } from "../src/features/session/model/messagePresentation"

describe("message delivery presentation", () => {
  it("does not infer delivery state for canonical user messages", () => {
    expect(deliveryBadgeForMessage({ info: { role: "user" } })).toBeUndefined()
  })

  it.each(["sending", "accepted", "uncertain", "failed"] as const)("preserves explicit %s delivery", (delivery) => {
    expect(deliveryBadgeForMessage({ info: { delivery } })).toBe(delivery)
  })
})
