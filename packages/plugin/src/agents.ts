import type { AgentSummary } from "@remotty/protocol"

type AgentLike = Record<string, unknown>

export const primaryAgentSummaries = (agents: AgentLike[]): AgentSummary[] => agents
  .filter((agent) => agent.mode === "primary")
  .map((agent) => ({
    name: String(agent.name),
    description: typeof agent.description === "string" ? agent.description : undefined,
    mode: "primary",
    color: typeof agent.color === "string" ? agent.color : undefined,
  }))
