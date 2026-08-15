import type { AgentSummary, AgentTheme, SubagentSummary } from "@remotty/protocol"

export type SessionAgent = AgentSummary & { agentTheme?: AgentTheme }
export type SessionSubagent = SubagentSummary & { workspaceId: string }
