import * as Plugin from "@opencode/plugin/tui/plugin"
import type { Context } from "@opencode/plugin/tui/context"
import type { AgentTheme } from "@remotty/protocol"
import { startRelay } from "./relayRuntime.js"

type RgbaLike = { toInts: () => [number, number, number, number] }
const themeColorRoles = ["secondary", "accent", "success", "warning", "primary", "error", "info"] as const
type ThemeColorRole = typeof themeColorRoles[number]
type ThemeColors = Record<ThemeColorRole, RgbaLike>
type ResolvedTheme = {
  text: {
    base: RgbaLike
    muted: RgbaLike
    action: { primary: { base: RgbaLike } }
    feedback: { success: { base: RgbaLike }; warning: { base: RgbaLike }; error: { base: RgbaLike }; info: { base: RgbaLike } }
  }
}
type RelayOwner = { token?: symbol; cleanup?: () => Promise<void>; stopping?: Promise<void> }

const colorByte = (value: number) => Math.min(255, Math.max(0, Math.round(Number.isFinite(value) ? value : 0)))
const isResolvedTheme = (value: unknown): value is ResolvedTheme => {
  if (!value || typeof value !== "object") return false
  const theme = value as Partial<ResolvedTheme>
  const colors = [theme.text?.base, theme.text?.muted, theme.text?.action?.primary?.base, theme.text?.feedback?.success?.base, theme.text?.feedback?.warning?.base, theme.text?.feedback?.error?.base, theme.text?.feedback?.info?.base]
  return colors.every((color) => typeof color?.toInts === "function")
}
export const rgbaToHex = (color: RgbaLike) => {
  const [red = 0, green = 0, blue = 0, alpha = 0] = color.toInts().map(colorByte)
  const hex = [red, green, blue].map((value) => value.toString(16).padStart(2, "0")).join("")
  return `#${hex}${alpha === 255 ? "" : alpha.toString(16).padStart(2, "0")}`
}
export const agentThemeSnapshot = (name: string, mode: AgentTheme["mode"], colors: ThemeColors): AgentTheme => ({
  name, mode, colors: Object.fromEntries(themeColorRoles.map((role) => [role, rgbaToHex(colors[role])])) as AgentTheme["colors"],
})
export const agentThemeFingerprint = (theme: AgentTheme) => JSON.stringify(theme)
export const shouldPublishAgentTheme = (published: string | undefined, publishing: string | undefined, fingerprint: string, nextRetryAt = 0, now = Date.now()) => fingerprint !== published && !publishing && now >= nextRetryAt
export const selectedSessionId = (route: { type: string; sessionID?: string }) => route.type === "session" && typeof route.sessionID === "string" ? route.sessionID : undefined
const themeSnapshot = (theme: unknown, mode: AgentTheme["mode"]): AgentTheme | undefined => {
  if (!isResolvedTheme(theme)) return undefined
  return agentThemeSnapshot("opencode", mode, {
    secondary: theme.text.muted,
    accent: theme.text.action.primary.base,
    success: theme.text.feedback.success.base,
    warning: theme.text.feedback.warning.base,
    primary: theme.text.base,
    error: theme.text.feedback.error.base,
    info: theme.text.feedback.info.base,
  })
}

export const setupTuiRelay = async (api: Context, start: typeof startRelay = startRelay) => {
  if (!api.location?.directory) return
  const [owner, mutateOwner] = api.storage.memory<RelayOwner>("remotty.relay", { initial: {} })
  const token = Symbol("remotty.relay")
  const stopping = owner.stopping ?? Promise.resolve().then(() => owner.cleanup?.())
  mutateOwner((draft) => {
    draft.token = token
    draft.cleanup = undefined
    draft.stopping = stopping
  })
  await stopping
  if (owner.token !== token) return async () => undefined
  let finishStarting: () => void
  const starting = new Promise<void>((resolve) => { finishStarting = resolve })
  mutateOwner((draft) => {
    if (draft.token === token) draft.stopping = starting
  })
  let cleanup: () => Promise<void>
  try {
    cleanup = await start({
      client: api.client,
      directory: api.location.directory,
      localDirectory: api.location.directory === process.cwd(),
      selectedSessionId: () => selectedSessionId(api.ui.router.current()),
      agentTheme: () => themeSnapshot(api.theme, api.themeMode),
      subscribe: (handler) => api.data.listen(({ details }) => handler(details)),
      log: (level, message, error) => console[level]("[remotty]", message, error ?? ""),
    })
  } catch (error) {
    if (owner.token === token) mutateOwner((draft) => { delete draft.token; delete draft.stopping })
    finishStarting!()
    throw error
  }
  if (owner.token !== token) {
    await cleanup()
    finishStarting!()
    return async () => undefined
  }
  mutateOwner((draft) => { draft.cleanup = cleanup; delete draft.stopping })
  finishStarting!()
  let stopped = false
  return async () => {
    if (stopped) return
    stopped = true
    await cleanup()
    if (owner.token === token) mutateOwner((draft) => { delete draft.token; delete draft.cleanup; delete draft.stopping })
  }
}

const tui = Plugin.define({
  id: "remotty",
  setup: setupTuiRelay,
})

export default tui
