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
