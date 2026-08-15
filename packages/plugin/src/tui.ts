import type { TuiPlugin, TuiPluginModule, TuiRouteCurrent } from "@opencode-ai/plugin/tui"
import type { AgentTheme } from "@remotty/protocol"
import { agentThemeCommand } from "./agentTheme.js"

type RgbaLike = { toInts: () => [number, number, number, number] }
const themeColorRoles = ["secondary", "accent", "success", "warning", "primary", "error", "info"] as const
type ThemeColorRole = typeof themeColorRoles[number]
type ThemeColors = Record<ThemeColorRole, RgbaLike>
type ThemeApi = {
  ready: boolean
  selected: string
  mode: () => AgentTheme["mode"]
  current: ThemeColors
}

const colorByte = (value: number) => Math.min(255, Math.max(0, Math.round(Number.isFinite(value) ? value : 0)))

const isThemeApi = (value: unknown): value is ThemeApi => {
  if (!value || typeof value !== "object") return false
  const theme = value as { ready?: unknown; selected?: unknown; mode?: unknown; current?: unknown }
  if (typeof theme.ready !== "boolean" || typeof theme.selected !== "string" || typeof theme.mode !== "function") return false
  if (!theme.current || typeof theme.current !== "object") return false
  const colors = theme.current as Partial<Record<ThemeColorRole, unknown>>
  return themeColorRoles.every((role) => {
    const color = colors[role]
    return Boolean(color) && typeof color === "object" && typeof (color as { toInts?: unknown }).toInts === "function"
  })
}

export const rgbaToHex = (color: RgbaLike) => {
  const values = color.toInts()
  const red = colorByte(values[0] ?? 0)
  const green = colorByte(values[1] ?? 0)
  const blue = colorByte(values[2] ?? 0)
  const alpha = colorByte(values[3] ?? 0)
  const hex = [red, green, blue].map((value) => value.toString(16).padStart(2, "0")).join("")
  return `#${hex}${alpha === 255 ? "" : alpha.toString(16).padStart(2, "0")}`
}

export const agentThemeSnapshot = (name: string, mode: AgentTheme["mode"], colors: ThemeColors): AgentTheme => ({
  name,
  mode,
  colors: Object.fromEntries(themeColorRoles.map((role) => [role, rgbaToHex(colors[role])])) as AgentTheme["colors"],
})

export const agentThemeFingerprint = (theme: AgentTheme) => JSON.stringify(theme)
export const shouldPublishAgentTheme = (
  published: string | undefined,
  publishing: string | undefined,
  fingerprint: string,
  nextRetryAt = 0,
  now = Date.now(),
) => fingerprint !== published && !publishing && now >= nextRetryAt

type ThemePublishResult = { error?: unknown }
type ThemePublisher = (command: string) => Promise<ThemePublishResult>

export const createAgentThemePublisher = (publish: ThemePublisher, now: () => number = Date.now) => {
  let published: string | undefined
  let publishing: string | undefined
  let failures = 0
  let nextRetryAt = 0
  let retryFingerprint: string | undefined

  return {
    publish(theme: AgentTheme) {
      const fingerprint = agentThemeFingerprint(theme)
      const retryAt = retryFingerprint === fingerprint ? nextRetryAt : 0
      if (!shouldPublishAgentTheme(published, publishing, fingerprint, retryAt, now())) return
      const command = agentThemeCommand(theme)
      if (!command) return
      publishing = fingerprint
      void Promise.resolve().then(() => publish(command)).then((result) => {
        if (result.error) throw result.error
        published = fingerprint
        failures = 0
        nextRetryAt = 0
        retryFingerprint = undefined
      }).catch(() => {
        failures += 1
        retryFingerprint = fingerprint
        nextRetryAt = now() + Math.min(30_000, 1_000 * 2 ** (failures - 1))
      }).finally(() => {
        if (publishing === fingerprint) publishing = undefined
      })
    },
  }
}

export const selectedSessionId = (route: TuiRouteCurrent) => {
  if (route.name !== "session" || !route.params || typeof route.params.sessionID !== "string") return undefined
  return route.params.sessionID
}

const tui: TuiPlugin = async (api) => {
  let selected: string | undefined
  const themePublisher = createAgentThemePublisher((command) => api.client.tui.publish({
    body: { type: "tui.command.execute", properties: { command } },
  }))
  const publishSelection = () => {
    const next = selectedSessionId(api.route.current)
    if (!next) {
      selected = undefined
      return
    }
    if (next === selected) return
    selected = next
    void api.client.tui.publish({
      body: { type: "tui.session.select", properties: { sessionID: next } },
    }).then((result) => {
      if (result.error && selected === next) selected = undefined
    }, () => {
      if (selected === next) selected = undefined
    })
  }
  const publishTheme = () => {
    const themeApi = api.theme
    if (!isThemeApi(themeApi) || !themeApi.ready) return
    try {
      const mode = themeApi.mode()
      if (mode !== "dark" && mode !== "light") return
      themePublisher.publish(agentThemeSnapshot(themeApi.selected, mode, themeApi.current))
    } catch {
      // Older or partial TUI theme APIs must not interrupt session selection.
    }
  }
  const publishState = () => {
    publishSelection()
    publishTheme()
  }
  publishState()
  const timer = setInterval(publishState, 250)
  api.lifecycle.onDispose(() => clearInterval(timer))
}

const plugin: TuiPluginModule & { id: string } = {
  id: "remotty.session-selection",
  tui,
}

export default plugin
