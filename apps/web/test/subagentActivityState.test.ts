import { describe, expect, it } from "vitest"
import { childWorkLabel, subagentDisplayTitle, visibleSubagents } from "../src/features/session/model/subagentActivityState"

describe("subagentDisplayTitle", () => {
  it.each([
    ["Implement UI (@implement subagent)", "Implement UI"],
    ["Review (notes) ( @code-review subagent )  ", "Review (notes)"],
    ["Review (@org/review subagent)", "Review"],
    ["Review (notes)", "Review (notes)"],
    ["Review (@implement)", "Review (@implement)"],
    ["Review (implement subagent)", "Review (implement subagent)"],
    ["Review (@implement subagent) continues", "Review (@implement subagent) continues"],
    ["", ""],
  ])("formats %j as %j", (title, expected) => {
    expect(subagentDisplayTitle(title)).toBe(expected)
  })
})

describe("visibleSubagents", () => {
  it("caps even four active children at three, newest first", () => {
    const children = [
      { id: "old", status: "busy", updatedAt: 1 },
      { id: "new", status: "retry", updatedAt: 4 },
      { id: "middle", status: "busy", updatedAt: 2 },
      { id: "recent", status: "busy", updatedAt: 3 },
    ]
    expect(visibleSubagents(children).map((child) => child.id)).toEqual(["new", "recent", "middle"])
  })

  it("includes newer idle and error children before older active children", () => {
    const children = [
      { id: "working", status: "busy", updatedAt: 1 },
      { id: "ready", status: "idle", updatedAt: 3 },
      { id: "retrying", status: "retry", updatedAt: 2 },
      { id: "failed", status: "error", updatedAt: 4 },
    ]
    expect(visibleSubagents(children).map((child) => child.id)).toEqual(["failed", "ready", "retrying"])
    expect(visibleSubagents([])).toEqual([])
    expect(visibleSubagents(children.slice(0, 1))).toEqual(children.slice(0, 1))
  })
})

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
