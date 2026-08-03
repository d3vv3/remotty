import { describe, expect, it } from "vitest"
import { selectOpenSessions } from "../src/sessions"

describe("selectOpenSessions", () => {
  const sessions = [
    { id: "current", time: { updated: 3 } },
    { id: "background", time: { updated: 2 } },
    { id: "history", time: { updated: 1 } },
  ]

  it("keeps the selected session and background work", () => {
    expect(selectOpenSessions(sessions, { background: { type: "busy" } }, "current").sessions).toEqual([
      sessions[0],
      sessions[1],
    ])
  })

  it("drops historical sessions and selects the newest session by default", () => {
    const result = selectOpenSessions(sessions, {})
    expect(result.activeSessionId).toBe("current")
    expect(result.sessions).toEqual([sessions[0]])
  })
})
