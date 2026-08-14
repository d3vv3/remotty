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

  it("preserves an explicit color", () => {
    expect(primaryAgentSummaries([{ name: "build", mode: "primary", color: "#c0ffee" }])).toEqual([{
      name: "build",
      mode: "primary",
      color: "#c0ffee",
    }])
  })

  it("uses all visible agents to assign a primary agent fallback color", () => {
    expect(primaryAgentSummaries([
      { name: "explore", mode: "subagent" },
      { name: "shared", mode: "all" },
      { name: "build", mode: "primary" },
    ])).toEqual([{
      name: "build",
      mode: "primary",
      color: "success",
    }])
  })

  it("does not expose or count hidden agents", () => {
    expect(primaryAgentSummaries([
      { name: "hidden-primary", mode: "primary", hidden: true },
      { name: "hidden-subagent", mode: "subagent", hidden: true },
      { name: "build", mode: "primary" },
    ])).toEqual([{
      name: "build",
      mode: "primary",
      color: "secondary",
    }])
  })

  it("wraps the fallback palette", () => {
    expect(primaryAgentSummaries([
      ...Array.from({ length: 7 }, (_, index) => ({ name: `subagent-${index}`, mode: "subagent" })),
      { name: "build", mode: "primary" },
    ])).toMatchObject([{ name: "build", color: "secondary" }])
  })

  it("falls back when an explicit color is empty", () => {
    expect(primaryAgentSummaries([{ name: "build", mode: "primary", color: "" }])).toMatchObject([
      { name: "build", color: "secondary" },
    ])
  })
})
