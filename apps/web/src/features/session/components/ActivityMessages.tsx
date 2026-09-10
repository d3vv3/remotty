import type { activityPresentation } from "../model/activityPresentation"
import { deliveryBadgeForMessage } from "../model/messagePresentation"
import { ActivityMessage } from "./ActivityMessage"
import { PendingResponse } from "./PendingResponse"

export function ActivityMessages({ presentation, showToolCalls = true }: { presentation: ReturnType<typeof activityPresentation>; showToolCalls?: boolean }) {
  const { messages, pending, pendingInLastMessage, pendingPhase, pendingAuthor, subagent } = presentation
  return <>
    {messages.map((message, index) => {
      const inlinePending = pendingInLastMessage && index === messages.length - 1
      const filtered = showToolCalls ? message : { ...message, parts: message.parts.filter((part) => part.type !== "tool") }
      if (!showToolCalls && !inlinePending && !filtered.parts.some((part) => part.type === "text" && part.text?.trim())) return null
      return <ActivityMessage key={message.info.id} message={filtered} delivery={deliveryBadgeForMessage(message, presentation.deliveryMessages)} pending={inlinePending} pendingPhase={pendingPhase} subagent={subagent} />
    })}
    {pending && !pendingInLastMessage && <article className="message assistant" aria-label={`${pendingAuthor} response`}><header className="entry-byline"><strong>{pendingAuthor}</strong></header><div className="message-body"><PendingResponse phase={pendingPhase} author={pendingAuthor} subagent={subagent} /></div></article>}
  </>
}
