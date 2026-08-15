import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent } from "react"
import { ArrowLeft, Bot, Check, ChevronDown, Code2, CircleStop, Clock3, LoaderCircle, Send, UserRound, X } from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import type { PermissionRequest, QuestionRequest, SessionSummary } from "@remotty/protocol"
import { Button, IconButton } from "../../../components/ui"
import { PermissionPanel } from "../../permissions"
import { QuestionPanel } from "../../questions"
import { applyPreparedMessageProgress, commitManifestForRefresh, commitPreparedCanonicalMessages, emptyMessageCache, formatMessageCacheSaveFailure, isMessageCacheSaveFailure, messageCacheErrorDetail, messageInventory, migrateMessageCache, prepareCanonicalMessages, prepareMessageProgress, shouldReportCacheFailure, visibleCachedMessages, type CacheFailure, type MessageCache } from "../model/messageCache"
import { mergeByMessageId, promptDeliveryState } from "../model/messageReconciliation"
import { resolveAgentColor } from "../model/agentColor"
import { deliveryBadgeForMessage, deliveryLabel, type DeliveryState } from "../model/messagePresentation"
import { clearSubmittedDraft, resourceArray, retainedSessionState, type SessionResourceRevisions } from "../model/sessionState"
import { visibleSubagents } from "../model/subagentActivityState"
import type { SessionAgent, SessionSubagent } from "../model/sessionTypes"
import { SubagentActivity } from "./SubagentActivity"

type MessagePart = { type: string; text?: string; tool?: string; time?: { start?: number; end?: number }; state?: { status?: string; title?: string; input?: Record<string, unknown>; output?: string; error?: string; metadata?: Record<string, unknown> } }
type SessionMessage = { info: { id: string; role: string; parentID?: string; time?: { created?: number }; delivery?: DeliveryState; legacyPrompt?: boolean; knownMessageIds?: string[] }; parts: MessagePart[] }
type FileDiff = { file: string; status?: "added" | "modified" | "deleted" | "untracked"; additions: number; deletions: number; patch?: string; binary?: boolean; truncated?: boolean }
type WorkspaceDiff = { state: "ok" | "not_git"; files: FileDiff[]; truncated: boolean }
type WorkspacePatch = { patch?: string; truncated: boolean }
type SessionTodo = { id: string; content: string; status: string; priority: string }

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
  const [agent, setAgent] = useState(() => retained?.agent ?? session.agent ?? agents[0]?.name ?? "")
  const [selectedChildId, setSelectedChildId] = useState(() => retained?.selectedChildId)
  const [agentMenuOpen, setAgentMenuOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [messageCacheReadySession, setMessageCacheReadySession] = useState<string>()
  const [, setClock] = useState(0)
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const detailContentRef = useRef<HTMLDivElement>(null)
  const mountedRef = useRef(true)
  const followOutputRef = useRef(true)
  const lastScrollTopRef = useRef(0)
  const snapshotRef = useRef<Record<string, string>>({})
  const generationRef = useRef(0)
  const messageRefreshGenerationRef = useRef(0)
  const todosRefreshGenerationRef = useRef(0)
  const diffGenerationRef = useRef(0)
  const lastPersistenceFailureRef = useRef<CacheFailure | undefined>(undefined)
  const lastTodoPersistenceFailureRef = useRef<CacheFailure | undefined>(undefined)
  const selectedAgent = agents.find((item) => item.name === agent)
  const agentColors = useMemo(() => agents.map((item, index) => resolveAgentColor(item.color, index, item.agentTheme)), [agents])
  const selectedAgentIndex = agents.findIndex((item) => item.name === agent)
  const selectedAgentColor = resolveAgentColor(selectedAgent?.color, selectedAgentIndex >= 0 ? selectedAgentIndex : 0, selectedAgent?.agentTheme)
  const selectedAgentStyle = { "--agent-color": selectedAgentColor } as CSSProperties
  const visibleSubagentEntries = useMemo(() => visibleSubagents(subagents), [subagents])
  const showComposer = tab !== "subagents"
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
      try {
        const progress = key === "messages" ? async (partial: SessionMessage[], isRequestActive: () => boolean) => {
          if (!owns() || !isRequestActive()) return
          followOutputRef.current = true
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
          if (!values) return false
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
        return owns()
      } catch (error) {
        if (owns() && key === "messages" && !isMessageCacheSaveFailure(error)) onError(messageCacheErrorDetail(error))
        return false
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
    if (retainedRevision === resourceRevisions.messages) { setLoading(false); return }
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

  const visibleMessages = useMemo(
    () => messages.filter((message) => message.parts.some((part) => part.type === "text" || part.type === "tool")),
    [messages],
  )
  const isThinking = useMemo(
    () => messages.some((message) => message.parts.some((part) => part.type === "reasoning" && part.time?.start && !part.time.end)),
    [messages],
  )

  useLayoutEffect(() => {
    if (tab !== "activity" || !followOutputRef.current) return
    const frame = requestAnimationFrame(() => {
      if (detailContentRef.current) {
        detailContentRef.current.scrollTop = detailContentRef.current.scrollHeight
        lastScrollTopRef.current = detailContentRef.current.scrollTop
        followOutputRef.current = true
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [tab, visibleMessages])

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

  const resizePrompt = () => {
    const textarea = promptRef.current
    if (!textarea) return
    textarea.style.height = "42px"
    const height = Math.min(textarea.scrollHeight, 82)
    textarea.style.height = `${height}px`
    textarea.style.overflowY = textarea.scrollHeight > 82 ? "auto" : "hidden"
  }

  useEffect(resizePrompt, [prompt])

  const handlePromptKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    event.currentTarget.form?.requestSubmit()
  }
  const selectTab = (next: "activity" | "todos" | "changes" | "subagents") => {
    if (next === "activity") {
      followOutputRef.current = true
      requestAnimationFrame(() => {
        if (detailContentRef.current) {
          detailContentRef.current.scrollTop = detailContentRef.current.scrollHeight
          lastScrollTopRef.current = detailContentRef.current.scrollTop
          followOutputRef.current = true
        }
      })
    }
    setTab(next)
  }

  return (
    <div className="session-detail">
      <header className="detail-header">
        <IconButton className="back-button" aria-label="Back" icon={<ArrowLeft size={20} />} onClick={onBack} />
        <div>
          <div className="title-line"><span className={`status-dot ${session.status}`} /><h2>{session.title}</h2></div>
          <p>{session.directory}</p>
        </div>
        <div className="detail-actions">
          <div className="agent-control">
            <button
              type="button"
              className="agent-picker"
              style={selectedAgentStyle}
              aria-haspopup="listbox"
              aria-expanded={agentMenuOpen}
              onClick={() => setAgentMenuOpen((open) => !open)}
            >
              <span className="agent-picker-color" /><Bot size={15} />
              <span>{agent || "Select agent"}</span>
              <ChevronDown size={14} />
            </button>
            {agentMenuOpen && (
              <div className="agent-menu" role="listbox">
                {agents.map((item, index) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={item.name === agent}
                    className={item.name === agent ? "selected" : ""}
                    style={{ "--agent-color": agentColors[index] } as CSSProperties}
                    key={item.name}
                    onClick={() => { setAgent(item.name); setAgentMenuOpen(false) }}
                  >
                    <span className="agent-color" style={{ background: agentColors[index] }} />
                    <span><strong>{item.name}</strong>{item.description && <small>{item.description}</small>}</span>
                    {item.name === agent && <Check size={14} />}
                  </button>
                ))}
              </div>
            )}
          </div>
          {session.status === "busy" && (
            <Button
              variant="danger"
              title="Stop agent"
              startIcon={<CircleStop size={17} />}
              onClick={() => void request({ type: "session.abort", sessionId: session.id }).catch((error) => onError(error.message))}
            >Stop</Button>
          )}
        </div>
      </header>

      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "activity"} className={tab === "activity" ? "active" : ""} onClick={() => selectTab("activity")}>Activity</button>
        <button type="button" role="tab" aria-selected={tab === "todos"} className={tab === "todos" ? "active" : ""} onClick={() => selectTab("todos")}>Todos <span>{todos.filter((todo) => todo.status !== "completed" && todo.status !== "cancelled").length}</span></button>
        <button type="button" role="tab" aria-selected={tab === "changes"} className={tab === "changes" ? "active" : ""} onClick={() => selectTab("changes")}>Changes <span>{diffs.length}</span></button>
        {(supportsSubagents || visibleSubagentEntries.length > 0) && <button type="button" role="tab" aria-selected={tab === "subagents"} className={tab === "subagents" ? "active" : ""} onClick={() => selectTab("subagents")}>Subagents <span>{visibleSubagentEntries.length}</span></button>}
      </div>

      <div
        className={`detail-content ${tab === "subagents" ? "subagent-content" : ""}`}
        ref={detailContentRef}
        onScroll={(event) => {
          const element = event.currentTarget
          const scrollingUp = element.scrollTop < lastScrollTopRef.current - 1
          if (scrollingUp) followOutputRef.current = false
          else if (element.scrollHeight - element.scrollTop - element.clientHeight < 80) followOutputRef.current = true
          lastScrollTopRef.current = element.scrollTop
        }}
      >
        {tab === "activity" ? (
          <div className="message-list">
            {loading ? (
              <div className="empty-state"><LoaderCircle className="spin" size={22} /></div>
            ) : (
              <>
                {visibleMessages.map((message) => <Message key={message.info.id} message={message} delivery={deliveryBadgeForMessage(message)} />)}
                {visibleMessages.length === 0 && <div className="empty-state"><p>No message activity yet.</p></div>}
              </>
            )}
          </div>
        ) : tab === "todos" ? (
          <div className="todo-list">
            {todos.map((todo) => (
              <div className={`todo-row ${todo.status}`} key={todo.id}>
                <span className="todo-mark">{todo.status === "completed" ? <Check size={14} /> : todo.status === "in_progress" ? <LoaderCircle className="spin" size={14} /> : todo.status === "cancelled" ? <X size={14} /> : null}</span>
                <span>{todo.content}</span>
                <small>{todo.priority}</small>
              </div>
            ))}
            {todos.length === 0 && <div className="empty-state"><p>No todos in this session.</p></div>}
          </div>
        ) : tab === "changes" ? (
          <div className="change-list">
            {diffState === "loading" && <div className="empty-state"><LoaderCircle className="spin" size={22} /></div>}
            {diffs.map((diff) => (
              <ChangeEntry key={`${diffVersion}:${diff.file}`} diff={diff} sessionId={session.id} request={request} onError={onError} />
            ))}
            {diffTruncated && <p className="change-notice">Some files were omitted because the workspace contains more than 500 changes.</p>}
            {diffState === "not_git" && <div className="empty-state"><p>{session.directory} is not a Git working tree.</p></div>}
            {diffState === "ok" && diffs.length === 0 && <div className="empty-state"><p>The working tree matches the latest commit.</p></div>}
            {diffState === "error" && <div className="empty-state"><p>Workspace changes could not be loaded.</p></div>}
          </div>
        ) : <SubagentActivity subagents={visibleSubagentEntries} selectedChildId={selectedChildId} onSelect={setSelectedChildId} request={request} revisions={subagentRevisions} />}
      </div>

      {(permission || question || showComposer) && <div className={`input-dock ${tab === "subagents" ? "subagent-dock" : ""}`}>
        {permission && <PermissionPanel permission={permission} request={request} onError={onError} />}
        {question && <QuestionPanel requestInfo={question} request={request} onError={onError} />}
        {showComposer && (session.status === "busy" || session.status === "retry") && (
          <div className="work-strip" role="status">
            <span className="work-pulse"><i /><i /><i /></span>
            <strong>{isThinking ? "Thinking" : "Working"}</strong>
          </div>
        )}
        {showComposer && <form className="composer" onSubmit={submit}>
          <textarea
            ref={promptRef}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={handlePromptKeyDown}
            placeholder={session.status === "idle" ? "Ask OpenCode to continue..." : "Send another instruction..."}
            rows={1}
            aria-label="Message OpenCode"
          />
          <IconButton variant="primary" type="submit" loading={sending} aria-label="Send prompt" icon={<Send size={19} />} disabled={!prompt.trim() || messageCacheReadySession !== session.id} />
        </form>}
      </div>}
    </div>
  )
}
function ChangeEntry({
  diff,
  sessionId,
  request,
  onError,
}: {
  diff: FileDiff
  sessionId: string
  request: (command: any) => Promise<unknown>
  onError: (error?: string) => void
}) {
  const [patch, setPatch] = useState(diff.patch)
  const [patchState, setPatchState] = useState<"idle" | "loading" | "ready" | "error">(diff.patch ? "ready" : "idle")
  const [patchTruncated, setPatchTruncated] = useState(Boolean(diff.truncated))

  const loadPatch = async () => {
    if (patchState !== "idle" || diff.status === "untracked" || !diff.status) return
    setPatchState("loading")
    try {
      const result = await request({ type: "workspace.diff.patch", sessionId, file: diff.file }) as WorkspacePatch
      if (!result || typeof result.truncated !== "boolean" || (result.patch !== undefined && typeof result.patch !== "string")) throw new Error("The relay returned an invalid file patch.")
      setPatch(result.patch)
      setPatchTruncated(result.truncated)
      setPatchState("ready")
    } catch (error) {
      setPatchState("error")
      onError((error as Error).message)
    }
  }

  return (
    <details className="change-entry" onToggle={(event) => { if (event.currentTarget.open) void loadPatch() }}>
      <summary className="change-row">
        <small className={`change-status ${diff.status ?? "modified"}`}>{diff.status ?? "changed"}</small>
        <code>{diff.file}</code>
        <span><b>+{diff.additions}</b><i>-{diff.deletions}</i></span>
        <ChevronDown size={15} />
      </summary>
      <div className="change-patch">
        {patchState === "loading"
          ? <p><LoaderCircle className="spin" size={15} /> Loading patch</p>
          : patch
            ? <pre><code>{patch}</code></pre>
            : <p>{diff.status === "untracked" ? "Untracked file content is not transferred automatically." : !diff.status ? "Update the workspace plugin to view this patch." : diff.binary ? "Binary file changed." : patchTruncated ? "Patch is too large to display." : patchState === "error" ? "Patch could not be loaded." : "No textual patch is available."}</p>}
      </div>
    </details>
  )
}
function Message({ message, delivery }: { message: SessionMessage; delivery?: DeliveryState }) {
  const isUser = message.info.role === "user"
  return (
    <article className={`message ${message.info.role}`} aria-label={isUser ? "Your message" : "OpenCode response"}>
      <div className="message-frame">
        <span className="message-sigil" aria-hidden="true">
          {isUser ? <UserRound size={15} /> : <Code2 size={16} />}
        </span>
        <div className="message-body">
          {delivery && <span className="delivery-flag"><Clock3 size={12} /> {deliveryLabel(delivery)}</span>}
          {message.info.time?.created && <time className="message-time" dateTime={new Date(message.info.time.created).toISOString()} title={new Date(message.info.time.created).toLocaleString()}>{relativeTime(message.info.time.created)}</time>}
          {message.parts.map((part, index) => {
            if (part.type === "text" && part.text) {
              if (isUser) return <p key={index}>{part.text}</p>
              return (
                <div className="markdown" key={index}>
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>,
                    }}
                  >
                    {part.text}
                  </ReactMarkdown>
                </div>
              )
            }
            if (part.type === "tool") {
              const diff = typeof part.state?.metadata?.diff === "string" ? part.state.metadata.diff : undefined
              const output = part.state?.output ?? part.state?.error
              return (
                <details className="tool-details" key={index}>
                  <summary className="tool-line">
                    <Code2 size={15} />
                    <span>{part.state?.title ?? part.tool}</span>
                    {diff && <small className="diff-available">Diff</small>}
                    <small>{part.state?.status}</small>
                    <ChevronDown size={14} className="tool-chevron" />
                  </summary>
                  <div className="tool-content">
                    {diff && <DiffBlock diff={diff} />}
                    {part.state?.input && Object.keys(part.state.input).length > 0 && (
                      <section><strong>Input</strong><pre><code>{limited(JSON.stringify(part.state.input, null, 2), 20_000)}</code></pre></section>
                    )}
                    {output && (
                      <section><strong>{part.state?.error ? "Error" : "Output"}</strong><pre><code>{limited(output, 30_000)}</code></pre></section>
                    )}
                  </div>
                </details>
              )
            }
            return null
          })}
        </div>
      </div>
    </article>
  )
}

function DiffBlock({ diff }: { diff: string }) {
  return (
    <section className="tool-diff">
      <strong>Diff</strong>
      <pre><code>{limited(diff, 50_000).split("\n").map((line, index) => (
        <span className={line.startsWith("+") && !line.startsWith("+++") ? "added" : line.startsWith("-") && !line.startsWith("---") ? "removed" : line.startsWith("@@") ? "hunk" : ""} key={index}>{line}{"\n"}</span>
      ))}</code></pre>
    </section>
  )
}

const limited = (value: string, limit: number) => value.length > limit ? `${value.slice(0, limit)}\n\n[output truncated]` : value

const relativeTime = (time: number) => {
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1_000))
  if (seconds < 60) return "now"
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h`
  return `${Math.floor(seconds / 86_400)}d`
}
