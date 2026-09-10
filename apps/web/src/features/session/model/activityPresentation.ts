import type { SessionMessage } from "./sessionContent"

export function activityPresentation(messages: SessionMessage[], status: string | undefined, loading: boolean, error: boolean, visibility: "content" | "all" = "content") {
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
  return { messages: visible, deliveryMessages: messages, pending, pendingInLastMessage }
}
