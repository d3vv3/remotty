import type { SubagentSummary } from "@remotty/protocol"

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

/** Shows active children first, followed by a bounded inactive history. */
export const visibleSubagents = <T extends Pick<SubagentSummary, "status" | "updatedAt">>(items: readonly T[], recentLimit = 3): T[] => {
  const newestFirst = (left: T, right: T) => right.updatedAt - left.updatedAt
  const active = items.filter((item) => item.status === "busy" || item.status === "retry").sort(newestFirst)
  const inactive = items.filter((item) => item.status !== "busy" && item.status !== "retry").sort(newestFirst)
  return [...active, ...inactive.slice(0, recentLimit)]
}
