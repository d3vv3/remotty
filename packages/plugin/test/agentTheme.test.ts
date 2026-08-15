import { describe, expect, it } from "vitest"
import { AGENT_THEME_COMMAND_PREFIX, MAX_AGENT_THEME_COMMAND_LENGTH, agentThemeCommand, agentThemeFromCommand, agentThemeFromTuiCommandEvent } from "../src/agentTheme"

const theme = {
  name: "default", mode: "dark",
  colors: { secondary: "#010203", accent: "#040506", success: "#070809", warning: "#0a0b0c", primary: "#0d0e0f", error: "#101112", info: "#131415" },
}

describe("agent theme command codec", () => {
  it("round-trips a complete strict theme through a canonical command", () => {
    const command = agentThemeCommand(theme)
    expect(command).toMatch(new RegExp(`^${AGENT_THEME_COMMAND_PREFIX}`))
    expect(command!.length).toBeLessThanOrEqual(MAX_AGENT_THEME_COMMAND_LENGTH)
    expect(agentThemeFromCommand(command)).toEqual(theme)
    expect(agentThemeCommand({ ...theme, extra: true })).toBeUndefined()
    expect(agentThemeCommand({ ...theme, colors: { ...theme.colors, primary: "red" } })).toBeUndefined()
  })

  it("rejects malformed, non-canonical, and oversized commands", () => {
    expect(agentThemeFromCommand(`${AGENT_THEME_COMMAND_PREFIX}%%%`)).toBeUndefined()
    expect(agentThemeFromCommand(`${AGENT_THEME_COMMAND_PREFIX}${"a".repeat(MAX_AGENT_THEME_COMMAND_LENGTH)}`)).toBeUndefined()
    const nonCanonical = `${AGENT_THEME_COMMAND_PREFIX}${Buffer.from(JSON.stringify({ ...theme, name: " default " })).toString("base64url")}`
    expect(agentThemeFromCommand(nonCanonical)).toBeUndefined()
  })

  it("handles only namespaced command events before relay forwarding", () => {
    const command = agentThemeCommand(theme)!
    expect(agentThemeFromTuiCommandEvent("tui.command.execute", { command })).toEqual({ handled: true, theme })
    expect(agentThemeFromTuiCommandEvent("tui.command.execute", { command: `${AGENT_THEME_COMMAND_PREFIX}bad!` })).toEqual({ handled: true, theme: undefined })
    expect(agentThemeFromTuiCommandEvent("tui.command.execute", { command: "session.new" })).toEqual({ handled: false })
    expect(agentThemeFromTuiCommandEvent("session.updated", { command })).toEqual({ handled: false })
  })
})
