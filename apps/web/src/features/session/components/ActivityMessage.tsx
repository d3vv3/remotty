import { Clock3, ListTodo, Code2, ChevronDown } from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { PendingResponse } from "./PendingResponse"
import { messageAuthor, type PendingPhase } from "../model/activityPresentation"
import { deliveryLabel, type DeliveryState } from "../model/messagePresentation"
import { limited, relativeTime, type MessagePart, type SessionMessage } from "../model/sessionContent"

function DiffBlock({ diff }: { diff: string }) {
  return <section className="tool-diff"><strong>Diff</strong><pre><code>{limited(diff, 50_000).split("\n").map((line, index) => (
    <span className={line.startsWith("+") && !line.startsWith("+++") ? "added" : line.startsWith("-") && !line.startsWith("---") ? "removed" : line.startsWith("@@") ? "hunk" : ""} key={index}>{line}{"\n"}</span>
  ))}</code></pre></section>
}

export function ToolDetails({ part }: { part: MessagePart }) {
  const diff = typeof part.state?.metadata?.diff === "string" ? part.state.metadata.diff : undefined
  const output = part.state?.output ?? part.state?.error
  return <details className="tool-details">
    <summary className="tool-line"><Code2 size={15} /><span>{part.state?.title ?? part.tool}</span>{diff && <small className="diff-available">Diff</small>}<small>{part.state?.status}</small><ChevronDown size={14} className="tool-chevron" /></summary>
    <div className="tool-content">
      {diff && <DiffBlock diff={diff} />}
      {part.state?.input && Object.keys(part.state.input).length > 0 && <section><strong>Input</strong><pre><code>{limited(JSON.stringify(part.state.input, null, 2), 20_000)}</code></pre></section>}
      {output && <section><strong>{part.state?.error ? "Error" : "Output"}</strong><pre><code>{limited(output, 30_000)}</code></pre></section>}
    </div>
  </details>
}

export function ActivityMessage({ message, delivery, pending = false, pendingPhase = "thinking", subagent = false }: { message: SessionMessage; delivery?: DeliveryState; pending?: boolean; pendingPhase?: PendingPhase; subagent?: boolean }) {
  const isUser = message.info.role === "user"
  const author = messageAuthor(message)
  return <article className={`message ${message.info.role}`} aria-label={isUser ? "Your message" : `${author} response`}>
    <header className="entry-byline">
      <strong>{author}</strong>
      {message.info.time?.created && <time className="message-time" dateTime={new Date(message.info.time.created).toISOString()} title={new Date(message.info.time.created).toLocaleString()}>{relativeTime(message.info.time.created)}</time>}
      {delivery && <span className={`delivery-flag${delivery === "accepted" ? " delivery-queued" : ""}`} role="status" aria-label={deliveryLabel(delivery)} title={deliveryLabel(delivery)}>
        {delivery === "accepted" ? <ListTodo size={16} aria-hidden="true" /> : <><Clock3 size={12} aria-hidden="true" />{deliveryLabel(delivery)}</>}
      </span>}
    </header>
    <div className="message-body">
        {message.parts.map((part, index) => part.type === "text" && part.text
          ? isUser ? <p key={index}>{part.text}</p> : <div className="markdown" key={index}><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer">{children}</a> }}>{part.text}</ReactMarkdown></div>
          : part.type === "tool" ? <ToolDetails part={part} key={index} /> : null)}
        {pending && <PendingResponse phase={pendingPhase} author={author} subagent={subagent} />}
    </div>
  </article>
}
