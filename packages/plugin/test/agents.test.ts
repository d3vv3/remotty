import { describe, expect, it } from "vitest"
import { primaryAgentSummaries } from "../src/agents"

describe("primaryAgentSummaries", () => {
  it("does not expose subagent or all-mode agents", () => {
    expect(primaryAgentSummaries([
      { name: "build", mode: "primary", description: "Primary", color: "#fff" },
      { name: "explore", mode: "subagent" },
      { name: "shared", mode: "all" },
    ])).toEqual([{
      name: "build",
      mode: "primary",
      description: "Primary",
      color: "#fff",
    }])
  })
})
