import type { activityPresentation } from "../model/activityPresentation"
import { deliveryBadgeForMessage } from "../model/messagePresentation"
import { ActivityMessage } from "./ActivityMessage"
import { PendingResponse } from "./PendingResponse"

export function ActivityMessages({ presentation, showToolCalls = true }: { presentation: ReturnType<typeof activityPresentation>; showToolCalls?: boolean }) {
  const { messages, pending, pendingInLastMessage } = presentation
  return <>
    {messages.map((message, index) => {
      const inlinePending = pendingInLastMessage && index === messages.length - 1
      const filtered = showToolCalls ? message : { ...message, parts: message.parts.filter((part) => part.type !== "tool") }
      if (!showToolCalls && !inlinePending && !filtered.parts.some((part) => part.type === "text" && part.text?.trim())) return null
      return <ActivityMessage key={message.info.id} message={filtered} delivery={deliveryBadgeForMessage(message, presentation.deliveryMessages)} pending={inlinePending} />
    })}
    {pending && !pendingInLastMessage && <article className="message assistant" aria-label="OpenCode response"><header className="entry-byline"><strong>OpenCode</strong></header><div className="message-body"><PendingResponse /></div></article>}
  </>
}
