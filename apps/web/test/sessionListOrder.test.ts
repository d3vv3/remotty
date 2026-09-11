import { describe, expect, it } from "vitest"
import { compareSessionListEntries, sessionListPriority } from "../src/features/workspace/workspaceModel"
import type { SessionSummary } from "@remotty/protocol"

describe("session list order", () => {
  it("prioritizes attention over work, then uses recency and deterministic identity ties", () => {
    const entry = (id: string, status: SessionSummary["status"], updatedAt: number): SessionSummary => ({
      id, status, updatedAt, title: id, directory: "/folder", additions: 0, deletions: 0, files: 0,
    })
    const sessions = [entry("ready", "idle", 100), entry("retry", "retry", 20), entry("busy", "busy", 30), entry("input", "busy", 1), entry("b", "error", 100), entry("a", "idle", 100)]
    const priority = (session: SessionSummary) => sessionListPriority(session, session.id === "input", false)
    expect([...sessions].sort((a, b) => compareSessionListEntries(a, b, priority)).map(session => session.id))
      .toEqual(["input", "busy", "retry", "a", "b", "ready"])
    expect([...sessions].reverse().sort((a, b) => compareSessionListEntries(a, b, priority)).map(session => session.id))
      .toEqual(["input", "busy", "retry", "a", "b", "ready"])
  })

  it("treats disconnected attention and work as offline", () => {
    expect(sessionListPriority({ status: "busy" }, true, true)).toBe(2)
    expect(sessionListPriority({ status: "retry" }, false, true)).toBe(2)
    expect(sessionListPriority({ status: "idle" }, true, false)).toBe(0)
  })
})
