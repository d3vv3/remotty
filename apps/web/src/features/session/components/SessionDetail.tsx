import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react"
import { ArrowLeft, Folder, GitBranch, CircleStop, Code2, ListTodo, GitCompareArrows, MessagesSquare, Network, LoaderCircle } from "lucide-react"
import type { PermissionRequest, QuestionRequest, SessionSummary } from "@remotty/protocol"
import { Button, IconButton, Tabs } from "../../../components/ui"
import { PermissionPanel } from "../../permissions"
import { QuestionPanel } from "../../questions"
import { applyPreparedMessageProgress, commitManifestForRefresh, commitPreparedCanonicalMessages, emptyMessageCache, formatMessageCacheSaveFailure, isMessageCacheSaveFailure, messageCacheErrorDetail, messageInventory, migrateMessageCache, prepareCanonicalMessages, prepareMessageProgress, shouldReportCacheFailure, visibleCachedMessages, type CacheFailure, type MessageCache } from "../model/messageCache"
import { mergeByMessageId, promptDeliveryState } from "../model/messageReconciliation"
import { activityPresentation } from "../model/activityPresentation"
import { sessionHeaderStatus } from "../model/sessionHeaderStatus"
import { clearSubmittedDraft, resourceArray, retainedSessionState, type SessionResourceRevisions } from "../model/sessionState"
import { visibleSubagents } from "../model/subagentActivityState"
import type { SessionAgent, SessionSubagent } from "../model/sessionTypes"
import type { FileDiff, SessionMessage, SessionTodo, WorkspaceDiff } from "../model/sessionContent"
import { useActivityScroll } from "../hooks/useActivityScroll"
import { useOverlayHeight } from "../hooks/useOverlayHeight"
import { useShowToolCalls } from "../hooks/useShowToolCalls"
import { ActivityMessages } from "./ActivityMessages"
import { AgentPicker } from "./AgentPicker"
import { Changes } from "./Changes"
import { Composer } from "./Composer"
import { SubagentActivity } from "./SubagentActivity"
import { Todos } from "./Todos"

export function SessionDetail({
  session,
  sessionKey,
  agents,
  revision,
  resourceRevisions,
  subagents,
  subagentRevisions,
  supportsSubagents,
  permission,
  question,
  request,
  loadCache,
  saveCache,
  onBack,
  onError,
  focusPrompt,
  onPromptFocused,
}: {
  session: SessionSummary
  sessionKey: string
  agents: SessionAgent[]
  revision: number
  resourceRevisions: SessionResourceRevisions
  subagents: SessionSubagent[]
  subagentRevisions: Record<string, number>
  supportsSubagents?: boolean
  permission?: PermissionRequest
  question?: QuestionRequest
  request: (command: any, progress?: (messages: SessionMessage[], isActive: () => boolean) => void | Promise<void>) => Promise<unknown>
  loadCache: <T>(resource: string) => Promise<{ value: T; syncedAt: number } | undefined>
  saveCache: <T>(resource: string, value: T) => Promise<void>
  onBack: () => void
  onError: (error?: string) => void
  focusPrompt?: boolean
  onPromptFocused: () => void
}) {
  const retained = retainedSessionState.read(sessionKey)
  const [showToolCalls, setShowToolCalls] = useShowToolCalls()
  const [selectorHeight, setSelectorHeight] = useState(0)
  const [messages, setMessages] = useState<SessionMessage[]>(() => retained?.messages as SessionMessage[] ?? [])
  const messageCacheRef = useRef<MessageCache<SessionMessage>>(retained?.messageCache as MessageCache<SessionMessage> ?? emptyMessageCache())
  const [diffs, setDiffs] = useState<FileDiff[]>(() => retained?.diffs as FileDiff[] ?? [])
  const [diffState, setDiffState] = useState<"idle" | "loading" | "ok" | "not_git" | "error">(() => retained?.diffState ?? "idle")
  const [diffTruncated, setDiffTruncated] = useState(() => retained?.diffTruncated ?? false)
  const [diffVersion, setDiffVersion] = useState(0)
  const [todos, setTodos] = useState<SessionTodo[]>(() => retained?.todos as SessionTodo[] ?? [])
  const [prompt, setPrompt] = useState(() => retained?.draft ?? "")
  const [sending, setSending] = useState(false)
  const [tab, setTab] = useState<"activity" | "todos" | "changes" | "subagents">(() => retained?.tab ?? "activity")
  const headerOverlay = useOverlayHeight<HTMLElement>(tab !== "subagents")
  const dockOverlay = useOverlayHeight<HTMLDivElement>()
  const [agent, setAgent] = useState(() => retained?.agent ?? session.agent ?? agents[0]?.name ?? "")
  const [selectedChildId, setSelectedChildId] = useState(() => retained?.selectedChildId)
  const [loading, setLoading] = useState(true)
  const [messagesLoading, setMessagesLoading] = useState(true)
  const [messagesError, setMessagesError] = useState(false)
  const [messageCacheReadySession, setMessageCacheReadySession] = useState<string>()
  const [, setClock] = useState(0)
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const mountedRef = useRef(true)
  const snapshotRef = useRef<Record<string, string>>({})
  const generationRef = useRef(0)
  const messageRefreshGenerationRef = useRef(0)
  const todosRefreshGenerationRef = useRef(0)
  const diffGenerationRef = useRef(0)
  const lastPersistenceFailureRef = useRef<CacheFailure | undefined>(undefined)
  const lastTodoPersistenceFailureRef = useRef<CacheFailure | undefined>(undefined)
  const visibleSubagentEntries = useMemo(() => visibleSubagents(subagents), [subagents])
  const subagentsWorking = subagents.some((child) => child.status === "busy" || child.status === "retry")
  const showComposer = tab !== "subagents"
  const headerStatus = sessionHeaderStatus(session, permission, question)
  const persistMessageCache = useCallback((cache: MessageCache<SessionMessage>) => {
    messageCacheRef.current = cache
    const visible = visibleCachedMessages(cache)
    setMessages(visible)
    retainedSessionState.write(sessionKey, { messageCache: cache, messages: visible })
    return saveCache("messages", cache).then(() => {
      lastPersistenceFailureRef.current = undefined
    }).catch((cause) => {
      const message = formatMessageCacheSaveFailure(cause)
      const now = Date.now()
      if (shouldReportCacheFailure(lastPersistenceFailureRef.current, message, now)) {
        onError(message)
        lastPersistenceFailureRef.current = { message, at: now }
      }
      throw new Error(message, { cause })
    })
  }, [onError, saveCache, sessionKey])
  const persistLocalMessages = useCallback((messages: SessionMessage[]) =>
    persistMessageCache({ ...messageCacheRef.current, local: { ...messageCacheRef.current.local, messages: messages.filter((message) => message.info.delivery !== undefined) } }), [persistMessageCache])
  const persistTodosCache = useCallback((todos: SessionTodo[]) => {
    void saveCache("todos", todos).then(() => {
      lastTodoPersistenceFailureRef.current = undefined
    }).catch((cause) => {
      const message = `Todos are current, but local cache could not be saved: ${messageCacheErrorDetail(cause)}`
      const now = Date.now()
      if (shouldReportCacheFailure(lastTodoPersistenceFailureRef.current, message, now)) {
        onError(message)
        lastTodoPersistenceFailureRef.current = { message, at: now }
      }
    })
  }, [onError, saveCache])

  const refreshDiffs = async (): Promise<boolean> => {
    const generation = ++diffGenerationRef.current
    setDiffState("loading")
    try {
      const result = await request({ type: "workspace.diff", sessionId: session.id })
      if (!mountedRef.current || generation !== diffGenerationRef.current) return false
      if (Array.isArray(result)) {
        setDiffs(result as FileDiff[])
        setDiffTruncated(false)
        setDiffVersion((version) => version + 1)
        setDiffState("ok")
        return true
      }
      const workspace = result as WorkspaceDiff
      if (!workspace || !Array.isArray(workspace.files) || !["ok", "not_git"].includes(workspace.state)) throw new Error("The relay returned an invalid workspace diff.")
      setDiffs(workspace.files)
      setDiffTruncated(Boolean(workspace.truncated))
      setDiffVersion((version) => version + 1)
      setDiffState(workspace.state)
      return true
    } catch (error) {
      if (!mountedRef.current || generation !== diffGenerationRef.current) return false
      setDiffState("error")
      onError((error as Error).message)
      return false
    }
  }

  const refresh = async (resources: Array<"messages" | "todos"> = ["messages", "todos"]): Promise<Record<"messages" | "todos", boolean>> => {
    const load = async <T,>(
      key: "messages" | "todos",
      command: Record<string, unknown>,
      update: (value: T[]) => void,
    ): Promise<boolean> => {
      const generationRef = key === "messages" ? messageRefreshGenerationRef : todosRefreshGenerationRef
      const generation = ++generationRef.current
      const owns = () => mountedRef.current && generation === generationRef.current
      if (key === "messages") setMessagesLoading(true)
      try {
        const progress = key === "messages" ? async (partial: SessionMessage[], isRequestActive: () => boolean) => {
          if (!owns() || !isRequestActive()) return
          const prepared = await prepareMessageProgress(partial)
          if (!owns() || !isRequestActive()) return
          const cache = applyPreparedMessageProgress(messageCacheRef.current, prepared)
          await persistMessageCache(cache)
        } : undefined
        const result = await request(key === "messages" ? { ...command, sync: { version: 1, known: messageInventory(messageCacheRef.current) } } : command, progress)
        if (!owns()) return false
        {
          const delta = result && typeof result === "object" && "deltaManifest" in result && Array.isArray((result as { messages?: unknown }).messages)
            ? result as { deltaManifest: any; messages: SessionMessage[] }
            : undefined
          const values = resourceArray(result)
          if (!values) throw new Error("The relay returned invalid activity data.")
          const next = values as T[]
          const snapshot = JSON.stringify(next)
          if (key === "messages" || snapshotRef.current[key] !== snapshot) {
            snapshotRef.current[key] = snapshot
            if (key === "messages") {
              if (delta) {
                const committed = commitManifestForRefresh(messageCacheRef.current, generation, messageRefreshGenerationRef.current, delta.deltaManifest)
                if (!committed) throw new Error("Delta transfer was incomplete")
                await persistMessageCache(committed)
              } else {
                const prepared = await prepareCanonicalMessages(next as SessionMessage[])
                if (!owns()) return false
                const committed = commitPreparedCanonicalMessages(messageCacheRef.current, prepared)
                if (!committed) throw new Error("Could not construct canonical message cache")
                await persistMessageCache(committed)
              }
            }
            else update(next)
            if (key === "todos") persistTodosCache(next as SessionTodo[])
          }
        }
        if (owns() && key === "messages") setMessagesError(false)
        return owns()
      } catch (error) {
        if (owns() && key === "messages") setMessagesError(true)
        if (owns() && key === "messages" && !isMessageCacheSaveFailure(error)) onError(messageCacheErrorDetail(error))
        return false
      } finally {
        if (owns() && key === "messages") setMessagesLoading(false)
      }
    }
    const outcomes = await Promise.all(resources.map(async (resource) => [resource, resource === "messages"
      ? await load<SessionMessage>("messages", { type: "session.messages", sessionId: session.id }, setMessages)
      : await load<SessionTodo>("todos", { type: "session.todos", sessionId: session.id }, setTodos)] as const))
    if (!mountedRef.current) return { messages: false, todos: false }
    setLoading(false)
    return Object.fromEntries(outcomes) as Record<"messages" | "todos", boolean>
  }

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    const generation = ++generationRef.current
    ++messageRefreshGenerationRef.current
    ++todosRefreshGenerationRef.current
    ++diffGenerationRef.current
    setMessageCacheReadySession(undefined)
    setLoading(true)
    setMessagesLoading(true)
    setMessagesError(false)
    const remembered = retainedSessionState.read(sessionKey)
    if (remembered?.messageCache) {
      messageCacheRef.current = remembered.messageCache as MessageCache<SessionMessage>
      setMessages(visibleCachedMessages(messageCacheRef.current))
      setMessageCacheReadySession(session.id)
      setLoading(false)
      return
    }
    void Promise.all([
      loadCache<unknown>("messages").then(async (cached) => {
        if (generation !== generationRef.current) return
        const cache = cached ? await migrateMessageCache<SessionMessage>(cached.value) : emptyMessageCache<SessionMessage>()
        if (generation !== generationRef.current) return
        messageCacheRef.current = cache
        setMessages(visibleCachedMessages(cache))
        setMessageCacheReadySession(session.id)
      }).catch((error) => {
        if (generation !== generationRef.current) return
        onError(`Could not load local message cache: ${messageCacheErrorDetail(error)}`)
        const cache = emptyMessageCache<SessionMessage>()
        messageCacheRef.current = cache
        setMessages([])
        setMessageCacheReadySession(session.id)
      }),
      loadCache<SessionTodo[]>("todos").then((cached) => cached && generation === generationRef.current && setTodos((current) => current.length ? current : cached.value)).catch((error) => {
        if (generation !== generationRef.current) return
        onError(`Could not load local todos cache: ${messageCacheErrorDetail(error)}`)
      }),
    ]).then(() => { if (generation === generationRef.current) setLoading(false) })
  }, [loadCache, session.id, sessionKey])

  useEffect(() => {
    retainedSessionState.write(sessionKey, { draft: prompt, tab, agent, selectedChildId, messages, messageCache: messageCacheRef.current, todos, diffs, diffState, diffTruncated })
  }, [agent, diffState, diffTruncated, diffs, messages, prompt, selectedChildId, sessionKey, tab, todos])

  useEffect(() => {
    const timer = window.setInterval(() => setClock((value) => value + 1), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (agent && agents.some((item) => item.name === agent)) return
    setAgent(session.agent && agents.some((item) => item.name === session.agent) ? session.agent : agents[0]?.name ?? "")
  }, [session.agent, agents, agent])
  useEffect(() => {
    if (!selectedChildId || visibleSubagentEntries.some((child) => child.id === selectedChildId)) return
    setSelectedChildId(visibleSubagentEntries[0]?.id)
  }, [selectedChildId, visibleSubagentEntries])

  useEffect(() => {
    if (!focusPrompt) return
    const frame = requestAnimationFrame(() => {
      promptRef.current?.focus()
      onPromptFocused()
    })
    return () => cancelAnimationFrame(frame)
  }, [focusPrompt, onPromptFocused, session.id])

  useEffect(() => {
    if (messageCacheReadySession !== session.id) return
    const retainedRevision = retainedSessionState.read(sessionKey)?.refreshed?.messages
    if (retainedRevision === resourceRevisions.messages) { setLoading(false); setMessagesLoading(false); return }
    const timeout = window.setTimeout(() => void refresh(["messages"]).then((outcome) => {
      if (!outcome.messages) return
      retainedSessionState.write(sessionKey, { refreshed: { ...(retainedSessionState.read(sessionKey)?.refreshed ?? {}), messages: resourceRevisions.messages } })
    }), revision ? 350 : 0)
    return () => window.clearTimeout(timeout)
  }, [session.id, session.status, revision, resourceRevisions.messages, messageCacheReadySession, sessionKey])

  useEffect(() => {
    if (tab !== "todos") return
    if (retainedSessionState.read(sessionKey)?.refreshed?.todos === resourceRevisions.todos) return
    void refresh(["todos"]).then((outcome) => {
      if (!outcome.todos) return
      retainedSessionState.write(sessionKey, { refreshed: { ...(retainedSessionState.read(sessionKey)?.refreshed ?? {}), todos: resourceRevisions.todos } })
    })
  }, [tab, resourceRevisions.todos, sessionKey])

  useEffect(() => {
    if (tab !== "changes") return
    if (retainedSessionState.read(sessionKey)?.refreshed?.diffs === resourceRevisions.diffs) return
    const timeout = window.setTimeout(() => void refreshDiffs().then((success) => {
      if (!success) return
      retainedSessionState.write(sessionKey, { refreshed: { ...(retainedSessionState.read(sessionKey)?.refreshed ?? {}), diffs: resourceRevisions.diffs } })
    }), revision ? 500 : 0)
    return () => window.clearTimeout(timeout)
  }, [tab, revision, session.id, resourceRevisions.diffs, sessionKey])

  const presentation = useMemo(
    () => activityPresentation(messages, session.status, loading || messagesLoading, messagesError, "content", { agent: session.agent }),
    [messages, session.status, session.agent, loading, messagesLoading, messagesError],
  )
  const activityScroll = useActivityScroll(tab === "activity", [presentation, loading, showToolCalls, headerOverlay.height, dockOverlay.height])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!prompt.trim() || sending || messageCacheReadySession !== session.id) return
    const rawSubmitted = prompt
    const text = rawSubmitted.trim()
    const messageId = crypto.randomUUID()
    const knownMessageIds = [...new Set([
      ...messageCacheRef.current.canonical.manifest.map((entry) => entry.id),
      ...Object.keys(messageCacheRef.current.staged.records),
      ...messageCacheRef.current.local.messages.map((message) => message.info.id),
    ])]
    const optimistic: SessionMessage = { info: { id: messageId, role: "user", time: { created: Date.now() }, delivery: "sending", knownMessageIds }, parts: [{ type: "text", text }] }
    setMessages((current) => {
      const next = mergeByMessageId(current, [...current, optimistic])
      void persistLocalMessages(next).catch(() => undefined)
      return next
    })
    setSending(true)
    try {
      const acknowledgement = await request({
        type: "session.prompt",
        sessionId: session.id,
        text,
        agent: agent || undefined,
      })
      setMessages((current) => {
        // Legacy relays acknowledge before async OpenCode dispatch. Preserve user
        // text as uncertain until a later canonical response can reconcile it.
        const canonicalId = acknowledgement && typeof acknowledgement === "object" && typeof (acknowledgement as { messageId?: unknown }).messageId === "string" && (acknowledgement as { messageId: string }).messageId.startsWith("msg")
          ? (acknowledgement as { messageId: string }).messageId
          : undefined
        const next = canonicalId
          ? current.map((message) => message.info.id === messageId ? { ...message, info: { ...message.info, id: canonicalId, delivery: "accepted" as const } } : message)
          : current.map((message) => message.info.id === messageId ? { ...message, info: { ...message.info, delivery: "uncertain" as const, legacyPrompt: true } } : message)
        void persistLocalMessages(next).catch(() => undefined)
        return next
      })
      setPrompt((current) => clearSubmittedDraft(current, rawSubmitted))
    } catch (error) {
      const delivery = promptDeliveryState((error as Error).message)
      setMessages((current) => {
        const next = current.map((message) => message.info.id === messageId ? { ...message, info: { ...message.info, delivery, ...(delivery === "uncertain" ? { legacyPrompt: true } : {}) } } : message)
        void persistLocalMessages(next).catch(() => undefined)
        return next
      })
      onError((error as Error).message)
    } finally {
      setSending(false)
    }
  }

  const selectTab = (next: "activity" | "todos" | "changes" | "subagents") => {
    activityScroll.beforeTabChange(tab === "activity" && next !== "activity", tab !== "activity" && next === "activity")
    setTab(next)
  }

  return (
    <div className="session-detail" data-tab={tab} style={{ "--session-dock-height": `${dockOverlay.height}px`, "--session-header-height": `${headerOverlay.height}px`, "--subagent-selector-height": `${tab === "subagents" ? selectorHeight : 0}px` } as CSSProperties}>
      {tab !== "subagents" && <header ref={headerOverlay.ref} className="detail-header" data-status={headerStatus.state}>
        <div className="session-header-pill" data-active={session.status === "busy" || session.status === "retry"}>
        <IconButton className="back-button" aria-label="Back" icon={<ArrowLeft size={20} />} onClick={onBack} />
        <div className="session-heading">
          <h2 title={session.title} aria-describedby="session-context-description">{session.title}</h2>
          <div className="session-location">
            <span className="session-folder" title={session.directory} aria-label={`Workspace: ${session.directory}`}><Folder size={14} aria-hidden="true" /><span>{session.directory.split("/").filter(Boolean).at(-1) ?? session.directory}</span></span>
            {session.branch && <span className="session-branch" title={session.branch} aria-label={`Branch: ${session.branch}`}><GitBranch size={14} aria-hidden="true" /><span>{session.branch}</span></span>}
          </div>
          <span className={`session-status ${headerStatus.state} sr-only`} role="status" aria-atomic="true">{headerStatus.label}</span>
          <span id="session-context-description" className="sr-only">Workspace: {session.directory}. {session.branch && <>Branch: {session.branch}. </>}{session.additions} additions . {session.deletions} deletions</span>
        </div>
        </div>
      </header>}

      <div
        id="session-tabpanel"
        role="tabpanel"
        tabIndex={0}
        aria-labelledby={`session-view-${tab}-tab`}
        className={`detail-content ${tab === "subagents" ? "subagent-content" : ""}`}
        ref={activityScroll.contentRef}
        onScroll={activityScroll.onScroll}
      >
        {tab === "activity" ? (
          <div className="message-list">
            {loading || (messagesLoading && presentation.messages.length === 0) ? (
              <div className="empty-state"><LoaderCircle className="spin" size={22} /></div>
            ) : (
              <>
                <ActivityMessages presentation={presentation} showToolCalls={showToolCalls} />
                {!messagesLoading && !presentation.pending && presentation.messages.length === 0 && <div className="empty-state"><p>No message activity yet.</p></div>}
              </>
            )}
          </div>
        ) : tab === "todos" ? (
          <Todos todos={todos} />
        ) : tab === "changes" ? (
          <Changes diffs={diffs} state={diffState} truncated={diffTruncated} version={diffVersion} directory={session.directory} sessionId={session.id} request={request} onError={onError} />
        ) : <SubagentActivity subagents={visibleSubagentEntries} selectedChildId={selectedChildId} onSelect={setSelectedChildId} request={request} revisions={subagentRevisions} showToolCalls={showToolCalls} headerHeight={headerOverlay.height} dockHeight={dockOverlay.height} onSelectorHeight={setSelectorHeight} />}
      </div>

      <div ref={dockOverlay.ref} className="session-dock">
        {(permission || question) && <div className="request-stack">
          {permission && <PermissionPanel permission={permission} request={request} onError={onError} />}
          {question && <QuestionPanel requestInfo={question} request={request} onError={onError} />}
        </div>}
        <div className="command-bar" role="group" aria-label="Session commands">
          {showComposer && <AgentPicker agents={agents} value={agent} onChange={setAgent} />}
          <Button className="tool-visibility-toggle" aria-label="Show tool calls" aria-pressed={showToolCalls} title={`Show tool calls: ${showToolCalls ? "on" : "off"}`} onClick={() => setShowToolCalls(!showToolCalls)} startIcon={<Code2 size={18} />}><span>Show tool calls</span></Button>
          {session.status === "busy" && <Button variant="danger" size="icon" aria-label="Stop agent" title="Stop agent" startIcon={<CircleStop size={20} />} onClick={() => void request({ type: "session.abort", sessionId: session.id }).catch((error) => onError(error.message))} />}
        </div>
        {showComposer && <Composer value={prompt} onChange={setPrompt} onSubmit={submit} sending={sending} disabled={messageCacheReadySession !== session.id} idle={session.status === "idle"} promptRef={promptRef} />}
      <nav className="session-tools" aria-label="Session tools">
        <Tabs<"activity" | "todos" | "changes" | "subagents">
          id="session-view"
          label="Session views"
          orientation="horizontal"
          value={tab}
          onChange={selectTab}
          options={[
            { value: "activity", label: <><MessagesSquare size={16} />Activity</>, panelId: "session-tabpanel" },
            { value: "todos", label: <><ListTodo size={16} />Todos <span>{todos.filter((todo) => todo.status !== "completed" && todo.status !== "cancelled").length}</span></>, panelId: "session-tabpanel" },
            { value: "changes", label: <><GitCompareArrows size={16} />Changes <span>{diffState === "idle" ? "-" : diffs.length}</span></>, panelId: "session-tabpanel" },
            ...((supportsSubagents || visibleSubagentEntries.length > 0) ? [{ value: "subagents" as const, label: <><Network size={16} />Subagents <span>{visibleSubagentEntries.length}</span></>, working: subagentsWorking, accessibleLabel: subagentsWorking ? `Subagents, agents working, ${visibleSubagentEntries.length}` : undefined, panelId: "session-tabpanel" }] : []),
          ]}
        />
      </nav>
      </div>
    </div>
  )
}
