import { describe, expect, it } from "vitest"
import { childWorkLabel } from "../src/features/session/model/subagentActivityState"

describe("childWorkLabel", () => {
  it("shows Thinking while an active child has open reasoning", () => {
    expect(childWorkLabel("busy", [{ parts: [{ type: "reasoning", time: { start: 1 } }] }])).toBe("Thinking")
  })

  it("shows Working for active children without open reasoning", () => {
    expect(childWorkLabel("retry", [{ parts: [{ type: "reasoning", time: { start: 1, end: 2 } }] }])).toBe("Working")
  })

  it("hides the label for inactive children", () => {
    expect(childWorkLabel("idle", [{ parts: [{ type: "reasoning", time: { start: 1 } }] }])).toBeUndefined()
  })
})
