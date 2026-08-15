import { describe, expect, it } from "vitest"
import { selectableAgentSummaries } from "../src/agents"

describe("selectableAgentSummaries", () => {
  it("exposes primary and all-mode agents but not subagents", () => {
    expect(selectableAgentSummaries([
      { name: "build", mode: "primary", description: "Primary", color: "#fff" },
      { name: "explore", mode: "subagent" },
      { name: "shared", mode: "all" },
    ])).toEqual([{
      name: "build",
      mode: "primary",
      description: "Primary",
      color: "#fff",
    }, {
      name: "shared",
      mode: "all",
      color: "success",
    }])
  })

  it("preserves an explicit color", () => {
    expect(selectableAgentSummaries([{ name: "build", mode: "primary", color: "#c0ffee" }])).toEqual([{
      name: "build",
      mode: "primary",
      color: "#c0ffee",
    }])
  })

  it("uses all visible agents to assign selectable-agent fallback colors", () => {
    expect(selectableAgentSummaries([
      { name: "explore", mode: "subagent" },
      { name: "shared", mode: "all" },
      { name: "build", mode: "primary" },
    ])).toEqual([{
      name: "shared",
      mode: "all",
      color: "accent",
    }, {
      name: "build",
      mode: "primary",
      color: "success",
    }])
  })

  it("does not expose or count hidden agents", () => {
    expect(selectableAgentSummaries([
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
    expect(selectableAgentSummaries([
      ...Array.from({ length: 7 }, (_, index) => ({ name: `subagent-${index}`, mode: "subagent" })),
      { name: "build", mode: "primary" },
    ])).toMatchObject([{ name: "build", color: "secondary" }])
  })

  it("falls back when an explicit color is empty", () => {
    expect(selectableAgentSummaries([{ name: "build", mode: "primary", color: "" }])).toMatchObject([
      { name: "build", color: "secondary" },
    ])
  })
})
