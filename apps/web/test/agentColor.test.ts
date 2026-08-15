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
    const theme = { name: "local", mode: "dark" as const, colors: { secondary: "#010203", accent: "#040506", success: "#070809", warning: "#0a0b0c", primary: "#0d0e0f", error: "#101112", info: "#131415" } }
    expect(resolveAgentColor("#c0ffee", 0, theme)).toBe("#c0ffee")
    expect(resolveAgentColor("hsl(200 70% 50%)", 0)).toBe("hsl(200 70% 50%)")
  })

  it("resolves semantic roles against the workspace TUI palette", () => {
    const theme = { name: "local", mode: "dark" as const, colors: { secondary: "#010203", accent: "#040506", success: "#070809", warning: "#0a0b0c", primary: "#0d0e0f", error: "#101112", info: "#131415" } }
    expect(agentColorRoles.map((role, index) => resolveAgentColor(role, index, theme))).toEqual(Object.values(theme.colors))
    expect(resolveAgentColor(undefined, 1, theme)).toBe("#040506")
  })

  it("passes unknown color strings through unchanged", () => {
    expect(resolveAgentColor("brand-highlight", 0)).toBe("brand-highlight")
  })
})
