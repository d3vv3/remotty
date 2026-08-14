import { describe, expect, it } from "vitest"
import { agentColorRoles, resolveAgentColor } from "../src/agentColor"

describe("resolveAgentColor", () => {
  it("maps every OpenCode semantic role to its CSS variable", () => {
    expect(agentColorRoles.map((role, index) => resolveAgentColor(role, index))).toEqual([
      "var(--opencode-agent-secondary)",
      "var(--opencode-agent-accent)",
      "var(--opencode-agent-success)",
      "var(--opencode-agent-warning)",
      "var(--opencode-agent-primary)",
      "var(--opencode-agent-error)",
      "var(--opencode-agent-info)",
    ])
  })

  it("uses and wraps the TUI palette for missing or empty legacy colors", () => {
    expect(resolveAgentColor(undefined, 0)).toBe("var(--opencode-agent-secondary)")
    expect(resolveAgentColor("", 8)).toBe("var(--opencode-agent-accent)")
  })

  it("preserves explicit CSS colors", () => {
    expect(resolveAgentColor("#c0ffee", 0)).toBe("#c0ffee")
    expect(resolveAgentColor("hsl(200 70% 50%)", 0)).toBe("hsl(200 70% 50%)")
  })

  it("passes unknown color strings through unchanged", () => {
    expect(resolveAgentColor("brand-highlight", 0)).toBe("brand-highlight")
  })
})
