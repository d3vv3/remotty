import { useLayoutEffect, useRef, useState } from "react"
import { LoaderCircle } from "lucide-react"
import { needsMessageRefresh, resourceArray, retainedSessionState } from "../model/sessionState"
import { childWorkLabel } from "../model/subagentActivityState"
import type { SessionSubagent } from "../model/sessionTypes"

type Message = { info: { id: string; role: string }; parts: Array<{ type: string; text?: string; tool?: string; time?: { start?: number; end?: number }; state?: { title?: string; status?: string; input?: unknown; output?: string; error?: string } }> }
const limited = (value: string, limit = 20_000) => value.length > limit ? `${value.slice(0, limit)}\n\n[output truncated]` : value

export function SubagentActivity({ subagents, selectedChildId, onSelect, request, revisions }: { subagents: SessionSubagent[]; selectedChildId?: string; onSelect: (id: string) => void; request: (command: any) => Promise<unknown>; revisions: Record<string, number> }) {
  const child = subagents.find((item) => item.id === selectedChildId) ?? subagents[0]
  const childKey = child ? `${child.workspaceId}:${child.id}` : ""
  const [messages, setMessages] = useState<Message[]>(() => retainedSessionState.read(childKey)?.messages as Message[] ?? [])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const requestRef = useRef(request)
  const messageScrollRef = useRef<HTMLDivElement>(null)
  requestRef.current = request
  useLayoutEffect(() => {
    if (!child) { setMessages([]); setError(undefined); setLoading(false); return }
    let active = true
    const retained = retainedSessionState.read(childKey)
    setMessages(retained?.messages as Message[] ?? [])
    setError(undefined)
    const revision = revisions[child.id] ?? 0
    if (!needsMessageRefresh(retained, revision)) { setLoading(false); return }
    setLoading(true)
    setError(undefined)
    void requestRef.current({ type: "session.messages", sessionId: child.id }).then((result) => {
      if (!active) return
      const items = resourceArray(result)
      if (!items) { setError("The relay returned invalid activity data."); return }
      const next = items as Message[]
      retainedSessionState.write(childKey, { messages: next, refreshed: { ...(retainedSessionState.read(childKey)?.refreshed ?? {}), messages: revision } })
      setMessages(next)
    }).catch((cause) => { if (active) setError((cause as Error).message) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [child?.id, childKey, child ? revisions[child.id] : 0])
  const workLabel = childWorkLabel(child?.status, messages)
  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => {
      const scroll = messageScrollRef.current
      if (scroll) scroll.scrollTop = scroll.scrollHeight
    })
    return () => cancelAnimationFrame(frame)
  }, [childKey, messages, loading, error, workLabel])
  return <div className="subagent-view"><div className="subagent-list">{subagents.map((item) => <button key={item.id} className={item.id === child?.id ? "selected" : ""} onClick={() => onSelect(item.id)}><span className={`status-dot ${item.status}`} /><strong>{item.title}</strong><small>parent {item.parentSessionId} . {new Date(item.updatedAt).toLocaleString()}</small></button>)}</div><div className="subagent-messages">{workLabel && <div className="work-strip" role="status"><span className="work-pulse"><i /><i /><i /></span><strong>{workLabel}</strong></div>}<div className="subagent-message-scroll" ref={messageScrollRef}><div className="message-list">{loading && <div className="empty-state"><LoaderCircle className="spin" size={22} /></div>}{error && <p className="change-notice">Activity refresh failed: {error}</p>}{messages.map((message) => <article className={`message ${message.info.role}`} key={message.info.id}><div className="message-body">{message.parts.map((part, index) => part.type === "text" ? <p key={index}>{part.text}</p> : part.type === "tool" ? <details className="tool-details" key={index}><summary className="tool-line"><span>{part.state?.title ?? part.tool ?? "Tool"}</span><small>{part.state?.status}</small></summary><div className="tool-content">{part.state?.input !== undefined && <section><strong>Input</strong><pre><code>{limited(JSON.stringify(part.state.input, null, 2))}</code></pre></section>}{(part.state?.output || part.state?.error) && <section><strong>{part.state?.error ? "Error" : "Output"}</strong><pre><code>{limited(part.state.error ?? part.state.output!)}</code></pre></section>}</div></details> : null)}</div></article>)}{!loading && child && messages.length === 0 && <div className="empty-state"><p>No message activity yet.</p></div>}</div></div></div></div>
}
