import { describe, expect, it } from "vitest"
import { completionNotification, completionSessionForEvent, shouldNotifySessionCompletion, type CompletionState } from "../src/notifications"

const state = (): CompletionState => ({ busy: new Set(), notified: new Set() })

describe("completionSessionForEvent", () => {
  it("notifies once when a busy session becomes idle", () => {
    const current = state()
    expect(completionSessionForEvent("session.status", { sessionID: "s1", status: { type: "busy" } }, current)).toBeUndefined()
    expect(completionSessionForEvent("session.status", { sessionID: "s1", status: { type: "idle" } }, current)).toBe("s1")
    expect(completionSessionForEvent("session.idle", { sessionID: "s1" }, current)).toBeUndefined()
  })

  it("accepts a dedicated idle event without prior status", () => {
    expect(completionSessionForEvent("session.idle", { sessionID: "s1" }, state())).toBe("s1")
  })

  it("rearms when the session becomes busy again", () => {
    const current = state()
    expect(completionSessionForEvent("session.idle", { sessionID: "s1" }, current)).toBe("s1")
    completionSessionForEvent("session.status", { sessionID: "s1", status: { type: "retry" } }, current)
    expect(completionSessionForEvent("session.idle", { sessionID: "s1" }, current)).toBe("s1")
  })

  it("does not treat an initial idle status as completed work", () => {
    expect(completionSessionForEvent("session.status", { sessionID: "s1", status: { type: "idle" } }, state())).toBeUndefined()
  })
})

describe("completionNotification", () => {
  it("opens the completed session", () => {
    expect(completionNotification("relay-1", "session-1", "Fix release workflow")).toEqual({
      type: "notification.show",
      title: "Agent finished",
      body: "Fix release workflow",
      tag: "relay-1:finished-session-1",
      actions: [],
      openApp: true,
      data: { sessionId: "session-1", workspaceRelayId: "relay-1" },
    })
  })

  it("only notifies for a known root session", () => {
    expect(shouldNotifySessionCompletion({})).toBe(true)
    expect(shouldNotifySessionCompletion({ parentID: "main-session" })).toBe(false)
    expect(shouldNotifySessionCompletion(undefined)).toBe(false)
  })
})
