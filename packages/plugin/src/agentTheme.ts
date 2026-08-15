import { agentThemeSchema, type AgentTheme } from "@remotty/protocol"

export const AGENT_THEME_COMMAND_PREFIX = "opencode-remotty.theme.v1:"
export const MAX_AGENT_THEME_COMMAND_LENGTH = 512

const encodedThemePattern = /^[A-Za-z0-9_-]+$/

const canonicalThemeJson = (theme: AgentTheme) => JSON.stringify({
  name: theme.name,
  mode: theme.mode,
  colors: {
    secondary: theme.colors.secondary,
    accent: theme.colors.accent,
    success: theme.colors.success,
    warning: theme.colors.warning,
    primary: theme.colors.primary,
    error: theme.colors.error,
    info: theme.colors.info,
  },
})

export const agentThemeCommand = (theme: unknown): string | undefined => {
  const parsed = agentThemeSchema.safeParse(theme)
  if (!parsed.success) return undefined
  const command = `${AGENT_THEME_COMMAND_PREFIX}${Buffer.from(canonicalThemeJson(parsed.data)).toString("base64url")}`
  return command.length <= MAX_AGENT_THEME_COMMAND_LENGTH ? command : undefined
}

export const isAgentThemeCommand = (command: unknown): command is string =>
  typeof command === "string" && command.startsWith(AGENT_THEME_COMMAND_PREFIX)

export const agentThemeFromCommand = (command: unknown): AgentTheme | undefined => {
  if (!isAgentThemeCommand(command) || command.length > MAX_AGENT_THEME_COMMAND_LENGTH) return undefined
  const payload = command.slice(AGENT_THEME_COMMAND_PREFIX.length)
  if (!payload || !encodedThemePattern.test(payload)) return undefined
  try {
    const json = Buffer.from(payload, "base64url").toString("utf8")
    if (Buffer.from(json).toString("base64url") !== payload) return undefined
    const parsed = agentThemeSchema.safeParse(JSON.parse(json))
    if (!parsed.success || agentThemeCommand(parsed.data) !== command) return undefined
    return parsed.data
  } catch {
    return undefined
  }
}

export const agentThemeFromTuiCommandEvent = (eventType: string, properties: Record<string, unknown>) => {
  if (eventType !== "tui.command.execute" || !isAgentThemeCommand(properties.command)) return { handled: false } as const
  return { handled: true, theme: agentThemeFromCommand(properties.command) } as const
}
