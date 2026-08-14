import type { AgentSummary } from "@remotty/protocol"

type AgentLike = Record<string, unknown>

const agentColorRoles = ["secondary", "accent", "success", "warning", "primary", "error", "info"] as const

export const primaryAgentSummaries = (agents: AgentLike[]): AgentSummary[] => {
  const visibleAgents = agents.filter((agent) => agent.hidden !== true)

  return visibleAgents
    .filter((agent) => agent.mode === "primary")
    .map((agent) => {
      const index = visibleAgents.findIndex((visibleAgent) => visibleAgent.name === agent.name)

      return {
        name: String(agent.name),
        description: typeof agent.description === "string" ? agent.description : undefined,
        mode: "primary",
        color: typeof agent.color === "string" && agent.color ? agent.color : agentColorRoles[index % agentColorRoles.length],
      }
    })
}
