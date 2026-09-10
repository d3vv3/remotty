import type { SubagentSummary } from "@remotty/protocol"

/** Remove only the generated trailing agent annotation; keep source titles intact. */
export const subagentDisplayTitle = (title: string): string =>
  title.replace(/\s*\(\s*@[^\s()]+\s+subagent\s*\)\s*$/, "")

export type SubagentMessagePart = {
  type: string
  time?: { start?: number; end?: number }
}

export type SubagentMessage = { parts: SubagentMessagePart[] }

/** Labels active children using the same open-reasoning rule as root activity. */
export const childWorkLabel = (
  status: string | undefined,
  messages: readonly SubagentMessage[],
): "Thinking" | "Working" | undefined => {
  if (status !== "busy" && status !== "retry") return undefined
  const isThinking = messages.some((message) =>
    message.parts.some((part) => part.type === "reasoning" && part.time?.start && !part.time.end),
  )
  return isThinking ? "Thinking" : "Working"
}

/** The protocol exposes updatedAt only: show the latest three across all statuses. */
export const visibleSubagents = <T extends Pick<SubagentSummary, "updatedAt">>(items: readonly T[]): T[] =>
  [...items].sort((left, right) => right.updatedAt - left.updatedAt).slice(0, 3)
