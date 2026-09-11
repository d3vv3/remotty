import { useLayoutEffect, useRef, useState, type CSSProperties } from "react"
import { Bot, LoaderCircle } from "lucide-react"
import { StatusIndicator, WarningNotice } from "../../../components/ui"
import { needsMessageRefresh, resourceArray, retainedSessionState } from "../model/sessionState"
import { subagentDisplayTitle, visibleSubagents } from "../model/subagentActivityState"
import { activityPresentation } from "../model/activityPresentation"
import type { SessionSubagent } from "../model/sessionTypes"
import type { SessionMessage as Message } from "../model/sessionContent"
import { ActivityMessages } from "./ActivityMessages"
import { useHorizontalOverflow } from "../../../hooks/useHorizontalOverflow"
import { useActivityScroll } from "../hooks/useActivityScroll"
import { useOverlayHeight } from "../hooks/useOverlayHeight"

const statusLabel = (status: SessionSubagent["status"]) => ({ busy: "Working", retry: "Retrying", idle: "Ready", error: "Error" })[status]

export function SubagentActivity({ subagents, selectedChildId, onSelect, request, revisions, showToolCalls = true, headerHeight = 0, dockHeight = 0, onSelectorHeight }: { subagents: SessionSubagent[]; selectedChildId?: string; onSelect: (id: string) => void; request: (command: any) => Promise<unknown>; revisions: Record<string, number>; showToolCalls?: boolean; headerHeight?: number; dockHeight?: number; onSelectorHeight?: (height: number) => void }) {
  const entries = visibleSubagents(subagents)
  const child = entries.find((item) => item.id === selectedChildId) ?? entries[0]
  const childKey = child ? `${child.workspaceId}:${child.id}` : ""
  const [messages, setMessages] = useState<Message[]>(() => retainedSessionState.read(childKey)?.messages as Message[] ?? [])
  const [loading, setLoading] = useState(() => child ? needsMessageRefresh(retainedSessionState.read(childKey), revisions[child.id] ?? 0) : false)
  const [error, setError] = useState<string>()
  const requestRef = useRef(request)
  const selectedPillRef = useRef<HTMLButtonElement>(null)
  const selectorOverlay = useOverlayHeight<HTMLDivElement>()
  useLayoutEffect(() => {
    onSelectorHeight?.(selectorOverlay.height)
  }, [onSelectorHeight, selectorOverlay.height])
  const entryIds = entries.map((item) => item.id).join(":")
  const { scrollRef: selectorRef, hasOverflowRight } = useHorizontalOverflow(entryIds)
  useLayoutEffect(() => {
    const list = selectorRef.current
    const pill = selectedPillRef.current
    if (!list || !pill) return
    const viewport = list.getBoundingClientRect()
    const selected = pill.getBoundingClientRect()
    if (viewport.right <= viewport.left) return
    // Keep the focus outline inside the scroll viewport, including at either end.
    const offset = selected.left < viewport.left + 12 ? selected.left - viewport.left - 12 : selected.right > viewport.right - 12 ? selected.right - viewport.right + 12 : 0
    if (offset) list.scrollBy({ left: offset, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" })
  }, [childKey, entryIds])
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
  const presentation = activityPresentation(messages, child?.status, loading, Boolean(error), "all", { agent: child?.agent, subagent: true })
  const { pending } = presentation
  const activityScroll = useActivityScroll(true, [childKey, messages, loading, error, pending, showToolCalls, headerHeight, selectorOverlay.height, dockHeight])
  return <div className="subagent-view" style={{ "--subagent-selector-height": `${selectorOverlay.height}px` } as CSSProperties}>
    <div ref={selectorOverlay.ref} className="subagent-selector" data-overflow-right={hasOverflowRight}>
    <div className="subagent-list" ref={selectorRef} role="group" aria-label="Latest subagents">{entries.map((item) => {
      const agent = item.agent?.trim() || "Subagent"
      const title = subagentDisplayTitle(item.title)
      const status = statusLabel(item.status)
      const selected = item.id === child?.id
      const active = item.status === "busy" || item.status === "retry"
      return <button key={item.id} type="button" ref={selected ? selectedPillRef : undefined} className={`subagent-pill${selected ? " selected" : ""}`} data-status={item.status} aria-pressed={selected} aria-label={`${title} . ${agent} . ${status}`} onClick={() => onSelect(item.id)}>
        <strong title={title}>{title}</strong>
        <span className="subagent-pill-meta"><span className="subagent-agent" title={agent}><Bot size={15} aria-hidden="true" /><span>{agent}</span></span>{!active && <span className={`subagent-status ${item.status}`}><StatusIndicator state={item.status} />{status}</span>}</span>
      </button>
    })}</div>
    </div>
    <div className="subagent-messages">
      <div className="subagent-message-scroll" ref={activityScroll.contentRef} onScroll={activityScroll.onScroll}>
        <div className="message-list">
          {loading && <div className="empty-state"><LoaderCircle className="spin" size={22} /></div>}
          {error && <WarningNotice>Activity refresh failed: {error}</WarningNotice>}
          <ActivityMessages presentation={presentation} showToolCalls={showToolCalls} />
          {!loading && !pending && child && presentation.messages.length === 0 && <div className="empty-state"><p>No message activity yet.</p></div>}
        </div>
      </div>
    </div>
  </div>
}
