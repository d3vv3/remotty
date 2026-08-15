import { describe, expect, it, vi } from "vitest"
import plugin from "../src/tui"
import { agentThemeFingerprint, agentThemeSnapshot, createAgentThemePublisher, rgbaToHex, selectedSessionId, shouldPublishAgentTheme } from "../src/tui"
import { agentThemeFromCommand } from "../src/agentTheme"

describe("selectedSessionId", () => {
  it("returns only the active session route", () => {
    expect(selectedSessionId({ name: "home" })).toBeUndefined()
    expect(selectedSessionId({ name: "session", params: { sessionID: "session-1" } })).toBe("session-1")
  })
})

describe("agent theme handoff", () => {
  const color = (values: [number, number, number, number]) => ({ toInts: () => values })

  it("preserves alpha only when needed and clamps invalid color bytes", () => {
    expect(rgbaToHex(color([1, 2, 3, 255]))).toBe("#010203")
    expect(rgbaToHex(color([1, 2, 3, 4]))).toBe("#01020304")
    expect(rgbaToHex(color([-1, 999, Number.NaN, 255]))).toBe("#00ff00")
  })

  it("builds a stable privacy-safe theme event payload", () => {
    const theme = agentThemeSnapshot("custom", "light", {
      secondary: color([1, 2, 3, 255]), accent: color([4, 5, 6, 255]), success: color([7, 8, 9, 255]),
      warning: color([10, 11, 12, 255]), primary: color([13, 14, 15, 255]), error: color([16, 17, 18, 255]), info: color([19, 20, 21, 255]),
    })
    expect(theme).toEqual({
      name: "custom", mode: "light",
      colors: { secondary: "#010203", accent: "#040506", success: "#070809", warning: "#0a0b0c", primary: "#0d0e0f", error: "#101112", info: "#131415" },
    })
    expect(agentThemeFingerprint(theme)).toBe(agentThemeFingerprint({ ...theme }))
  })

  it("suppresses unchanged and in-flight publishes while allowing retries", () => {
    expect(shouldPublishAgentTheme("theme", undefined, "theme")).toBe(false)
    expect(shouldPublishAgentTheme(undefined, "theme", "theme")).toBe(false)
    expect(shouldPublishAgentTheme(undefined, undefined, "theme")).toBe(true)
  })

  it("publishes the theme through the supported command event", async () => {
    let publishedCommand: unknown
    const publish = vi.fn(async (input: { body: { type: string; properties: { command: string } } }) => {
      publishedCommand = input.body.properties.command
      return { error: undefined }
    })
    let dispose: (() => void) | undefined
    const colorMap = {
      secondary: color([1, 2, 3, 255]), accent: color([4, 5, 6, 255]), success: color([7, 8, 9, 255]),
      warning: color([10, 11, 12, 255]), primary: color([13, 14, 15, 255]), error: color([16, 17, 18, 255]), info: color([19, 20, 21, 255]),
    }
    await plugin.tui({
      route: { current: { name: "home" } },
      theme: { ready: true, selected: "custom", mode: () => "dark", current: colorMap },
      client: { tui: { publish } },
      lifecycle: { onDispose: (callback: () => void) => { dispose = callback; return () => undefined } },
    } as never, undefined, {} as never)
    await Promise.resolve()
    await Promise.resolve()

    expect(publish).toHaveBeenCalledWith({
      body: {
        type: "tui.command.execute",
        properties: { command: expect.stringMatching(/^opencode-remotty\.theme\.v1:/) },
      },
    })
    expect(agentThemeFromCommand(publishedCommand)).toMatchObject({ name: "custom", mode: "dark" })
    dispose?.()
  })

  it("continues publishing session selection when the host has no theme API", async () => {
    const publish = vi.fn(async () => ({ error: undefined }))
    let dispose: (() => void) | undefined

    await expect(plugin.tui({
      route: { current: { name: "session", params: { sessionID: "session-1" } } },
      client: { tui: { publish } },
      lifecycle: { onDispose: (callback: () => void) => { dispose = callback; return () => undefined } },
    } as never, undefined, {} as never)).resolves.toBeUndefined()

    expect(publish).toHaveBeenCalledWith({
      body: { type: "tui.session.select", properties: { sessionID: "session-1" } },
    })
    dispose?.()
  })

  it("recovers from rejected publication without retrying on every poll", async () => {
    let now = 0
    const publish = vi.fn<() => Promise<{ error?: unknown }>>()
      .mockRejectedValueOnce(new Error("TUI unavailable"))
      .mockResolvedValueOnce({})
    const publisher = createAgentThemePublisher(publish, () => now)
    const theme = agentThemeSnapshot("custom", "dark", {
      secondary: color([1, 2, 3, 255]), accent: color([4, 5, 6, 255]), success: color([7, 8, 9, 255]),
      warning: color([10, 11, 12, 255]), primary: color([13, 14, 15, 255]), error: color([16, 17, 18, 255]), info: color([19, 20, 21, 255]),
    })

    publisher.publish(theme)
    await new Promise((resolve) => setTimeout(resolve, 0))
    publisher.publish(theme)
    expect(publish).toHaveBeenCalledOnce()
    expect(shouldPublishAgentTheme(undefined, undefined, agentThemeFingerprint(theme), 1_000, now)).toBe(false)

    publisher.publish({ ...theme, name: "alternate" })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(publish).toHaveBeenCalledTimes(2)

    publisher.publish({ ...theme, name: "alternate" })
    expect(publish).toHaveBeenCalledTimes(2)
  })
})
