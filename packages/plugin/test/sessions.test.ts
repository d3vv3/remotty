import { describe, expect, it } from "vitest"
import { includeActiveSession, rootSessionId, routeSessionRequests, selectOpenSessions } from "../src/sessions"

describe("selectOpenSessions", () => {
  const sessions = [
    { id: "current", time: { updated: 3 } },
    { id: "background", time: { updated: 2 } },
    { id: "history", time: { updated: 1 } },
  ]

  it("shows every root session in recency order", () => {
    expect(selectOpenSessions(sessions, "current").sessions).toEqual(sessions)
  })

  it("shows historical sessions before OpenCode selects one", () => {
    const result = selectOpenSessions(sessions)
    expect(result.activeSessionId).toBeUndefined()
    expect(result.sessions).toEqual(sessions)
  })

  it("excludes subagent sessions even while they are busy", () => {
    const subagent = { id: "subagent", parentID: "current", time: { updated: 4 } }
    const result = selectOpenSessions(
      [subagent, ...sessions],
      "subagent",
    )

    expect(result.activeSessionId).toBeUndefined()
    expect(result.sessions).toEqual(sessions)
  })

  it("retains a newly selected session until the API list catches up", () => {
    const created = { id: "created", time: { created: 4 } }
    expect(includeActiveSession(sessions, [...sessions, created], "created")).toEqual([created, ...sessions])
    expect(includeActiveSession([created, ...sessions], [...sessions, created], "created")).toEqual([created, ...sessions])
  })

  it("routes nested subagent input to its root without losing the reply target", () => {
    const hierarchy = [
      { id: "root" },
      { id: "child", parentID: "root" },
      { id: "grandchild", parentID: "child" },
    ]

    expect(rootSessionId("grandchild", hierarchy)).toBe("root")
    expect(routeSessionRequests([{ id: "permission", sessionID: "grandchild" }], hierarchy)).toEqual([{
      id: "permission",
      sessionID: "root",
      targetSessionID: "grandchild",
    }])
  })
})
