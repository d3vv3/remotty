import { describe, expect, it } from "vitest"
import { sessionHeaderStatus } from "../src/features/session/model/sessionHeaderStatus"

describe("session header presentation", () => {
  it.each([
    ["idle", "Ready"], ["busy", "Working"], ["retry", "Retrying"], ["error", "Error"],
  ] as const)("labels %s and gives root requests priority", (status, label) => {
    const session = { id: "root", status }
    expect(sessionHeaderStatus(session)).toEqual({ state: status, label })
    const attention = { state: "needs-input", label: "Needs attention" }
    expect(sessionHeaderStatus(session, { sessionID: "root" })).toEqual(attention)
    expect(sessionHeaderStatus(session, undefined, { sessionID: "root" })).toEqual(attention)
    expect(sessionHeaderStatus(session, { sessionID: "root" }, { sessionID: "root" })).toEqual(attention)
    expect(sessionHeaderStatus(session, { sessionID: "child" }, { sessionID: "other" })).toEqual({ state: status, label })
  })
})
