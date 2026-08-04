import { describe, expect, it } from "vitest"
import { selectedSessionId } from "../src/tui"

describe("selectedSessionId", () => {
  it("returns only the active session route", () => {
    expect(selectedSessionId({ name: "home" })).toBeUndefined()
    expect(selectedSessionId({ name: "session", params: { sessionID: "session-1" } })).toBe("session-1")
  })
})
