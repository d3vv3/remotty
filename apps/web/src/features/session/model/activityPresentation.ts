import type { SessionMessage } from "./sessionContent"

export type PendingPhase = "thinking" | "tool" | "delegating"

export function messageAuthor(message: SessionMessage): string {
  return message.info.role === "user" ? "You" : message.info.role === "system" ? "System" : message.info.agent?.trim() || "OpenCode"
}

function pendingPhase(messages: SessionMessage[]): PendingPhase {
  // Only the latest assistant in the current turn can describe active work.
  // Older tool records can retain unfinished states after processing advances.
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!
    if (message.info.role === "user") break
    if (message.info.role !== "assistant") continue
    if (message.info.time?.completed !== undefined) return "thinking"
    const activeTool = message.parts.findLast((part) => part.type === "tool" && (part.state?.status === "pending" || part.state?.status === "running"))
    return activeTool?.tool === "task" ? "delegating" : activeTool ? "tool" : "thinking"
  }
  return "thinking"
}

export function activityPresentation(messages: SessionMessage[], status: string | undefined, loading: boolean, error: boolean, visibility: "content" | "all" = "content", context: { agent?: string; subagent?: boolean } = {}) {
  // Preserve each view's history policy: subagents retain all journal bylines,
  // while primary Activity omits entries containing only internal parts.
  const visible = messages.filter((message) => visibility === "all" || message.parts.some((part) => part.type === "text" || part.type === "tool"))
  // Status is evidence of work, not a promise of a reply. A failed refresh or
  // initial fetch cannot reliably describe the current conversation.
  const pending = (status === "busy" || status === "retry") && !error && !(loading && visible.length === 0)
  const latest = messages.at(-1)
  if (pending && latest?.info.role === "assistant" && !visible.includes(latest)) visible.push(latest)
  const last = visible.at(-1)
  const pendingInLastMessage = pending && last?.info.role === "assistant" && !last.parts.some((part) => part.type === "tool" || (part.type === "text" && part.text?.trim()))
  const currentAssistant = messages.findLast((message) => message.info.role === "assistant" || message.info.role === "user")
  const pendingAuthor = (currentAssistant?.info.role === "assistant" ? currentAssistant.info.agent?.trim() : undefined) || context.agent?.trim() || "OpenCode"
  return { messages: visible, deliveryMessages: messages, pending, pendingInLastMessage, pendingPhase: pendingPhase(messages), pendingAuthor, subagent: context.subagent ?? false }
}
