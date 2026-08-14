export const agentColorRoles = ["secondary", "accent", "success", "warning", "primary", "error", "info"] as const

const semanticAgentColors: Record<(typeof agentColorRoles)[number], string> = {
  secondary: "var(--opencode-agent-secondary)",
  accent: "var(--opencode-agent-accent)",
  success: "var(--opencode-agent-success)",
  warning: "var(--opencode-agent-warning)",
  primary: "var(--opencode-agent-primary)",
  error: "var(--opencode-agent-error)",
  info: "var(--opencode-agent-info)",
}

export const resolveAgentColor = (color: string | undefined, visiblePrimaryIndex: number): string => {
  const resolved = color || agentColorRoles[visiblePrimaryIndex % agentColorRoles.length]
  return semanticAgentColors[resolved as keyof typeof semanticAgentColors] ?? resolved
}
