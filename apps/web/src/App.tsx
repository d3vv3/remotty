import { FormEvent, KeyboardEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import {
  AlertTriangle,
  ArrowLeft,
  Bell,
  BellOff,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  CircleStop,
  CircleHelp,
  Code2,
  Database,
  Folder,
  GitBranch,
  KeyRound,
  Laptop,
  LoaderCircle,
  LogOut,
  ShieldCheck,
  Smartphone,
  Terminal,
  RefreshCw,
  ScanLine,
  Send,
  ShieldAlert,
  UserRound,
  Wifi,
  WifiOff,
  X,
} from "lucide-react"
import type { IScannerControls } from "@zxing/browser"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import type { AgentSummary, PermissionRequest, QuestionRequest, SessionSummary } from "@remotty/protocol"
import { useRelay } from "./useRelay"
import { pairingCredentialFrom } from "./pairing"

type MessagePart = { type: string; text?: string; tool?: string; state?: { status?: string; title?: string; output?: string } }
type SessionMessage = { info: { id: string; role: string; time?: { created?: number } }; parts: MessagePart[] }
type FileDiff = { file: string; additions: number; deletions: number }
type SessionTodo = { id: string; content: string; status: string; priority: string }

export function App() {
  const relayState = useRelay()
  const [selectedId, setSelectedId] = useState<string | undefined>(
    () => new URLSearchParams(location.search).get("session") ?? undefined,
  )
  const selected = relayState.sessions.find((session) => session.id === selectedId)
  const sessionGroups = useMemo(() => {
    const groups = new Map<string, SessionSummary[]>()
    for (const session of relayState.sessions) {
      groups.set(session.directory, [...(groups.get(session.directory) ?? []), session])
    }
    return [...groups.entries()].sort(
      ([, left], [, right]) => Math.max(...right.map((session) => session.updatedAt)) - Math.max(...left.map((session) => session.updatedAt)),
    )
  }, [relayState.sessions])

  if (relayState.connection === "disconnected" && !relayState.relay) {
    return <PairingScreen onConnect={relayState.connect} error={relayState.error} />
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark"><Code2 size={18} /></span>
          <strong>remotty</strong>
        </div>
        <div className={`connection-state ${relayState.connection}`}>
          {relayState.connection === "online" ? <Wifi size={15} /> : <WifiOff size={15} />}
          {relayState.connection === "online" ? "Live" : "Relay offline"}
          <button
            className={`notification-button ${relayState.notificationsEnabled ? "enabled" : ""}`}
            title={relayState.notificationsEnabled ? "Disable notifications" : "Enable notifications"}
            onClick={() => void relayState.toggleNotifications()}
          >
            {relayState.notificationsEnabled ? <Bell size={15} /> : <BellOff size={15} />}
          </button>
        </div>
      </header>

      <div className="workspace-layout">
        <aside className={`session-panel ${selected ? "mobile-hidden" : ""}`}>
          <section className="relay-summary">
            <div className="machine-icon"><Laptop size={20} /></div>
            <div>
              <h1>{relayState.relays.length > 1 ? `${relayState.relays.length} workspaces` : relayState.relay?.name ?? "Connecting"}</h1>
              <p>{relayState.relays.length > 1 ? "OpenCode sessions grouped by folder" : relayState.relay?.workspace ?? "Waiting for your OpenCode relay"}</p>
            </div>
            <button className="icon-button" title="Disconnect" onClick={relayState.disconnect}><LogOut size={18} /></button>
          </section>

          <div className="section-heading">
            <span>Sessions</span>
            <button
              className="icon-button"
              title="Refresh sessions"
              onClick={() => void relayState.request({ type: "snapshot.request" })}
              disabled={relayState.connection !== "online"}
            >
              <RefreshCw size={17} />
            </button>
          </div>

          <div className="session-list">
            {sessionGroups.map(([directory, sessions]) => (
              <section className="workspace-group" key={directory}>
                <div className="workspace-heading" title={directory}>
                  <Folder size={14} />
                  <span><strong>{folderName(directory)}</strong><small>{directory}</small></span>
                  <b>{sessions.length}</b>
                </div>
                {sessions.map((session) => (
                  <SessionRow
                    key={session.id}
                    session={session}
                    selected={session.id === selectedId}
                    needsInput={relayState.permissions.some((item) => item.sessionID === session.id) || relayState.questions.some((item) => item.sessionID === session.id)}
                    onSelect={() => setSelectedId(session.id)}
                  />
                ))}
              </section>
            ))}
            {relayState.sessions.length === 0 && (
              <div className="empty-state">
                <LoaderCircle size={22} className={relayState.connection === "online" ? "" : "spin"} />
                <p>
                  {relayState.connection === "online"
                    ? "Open a new OpenCode session to get started."
                    : "Waiting for the local relay."}
                </p>
              </div>
            )}
          </div>
        </aside>

        <section className={`detail-panel ${!selected ? "mobile-hidden" : ""}`}>
          {selected ? (
            <SessionDetail
              key={selected.id}
              session={selected}
              agents={relayState.agents}
              revision={relayState.sessionRevisions[selected.id] ?? 0}
              permission={relayState.permissions.find((permission) => permission.sessionID === selected.id)}
              question={relayState.questions.find((question) => question.sessionID === selected.id)}
              request={relayState.request}
              onBack={() => setSelectedId(undefined)}
              onError={relayState.setError}
            />
          ) : (
            <div className="detail-placeholder">
              <Code2 size={32} />
              <h2>Select a session</h2>
              <p>Messages, changes, and agent controls appear here.</p>
            </div>
          )}
        </section>
      </div>

      {relayState.error && (
        <div className="toast" role="alert"><AlertTriangle size={17} />{relayState.error}</div>
      )}
    </main>
  )
}

function PairingScreen({ onConnect, error }: { onConnect: (code: string) => void; error?: string }) {
  const [code, setCode] = useState("")
  const [scannerOpen, setScannerOpen] = useState(false)
  const relayProtocol = location.protocol === "https:" ? "wss:" : "ws:"
  const broker = import.meta.env.VITE_REMOTTY_URL ?? `${relayProtocol}//${location.hostname}:8787/ws`
  const submit = (event: FormEvent) => {
    event.preventDefault()
    onConnect(code)
  }
  return (
    <main className="pairing-screen">
      <header className="landing-nav">
        <div className="brand-lockup"><span className="brand-mark"><Code2 size={18} /></span><strong>remotty</strong></div>
        <span>Remote TTY for OpenCode</span>
      </header>

      <section className="landing-hero">
        <div className="landing-intro">
          <p className="eyebrow">OpenCode, away from your desk</p>
          <h1>remotty</h1>
          <h2>Your agents can leave the desk.</h2>
          <p className="pairing-copy">Watch agents work, answer questions, approve commands, and send the next instruction from any installed PWA.</p>
          <form onSubmit={submit} className="pairing-form">
            <label htmlFor="pairing-code"><KeyRound size={14} /> Pairing key</label>
            <div className="code-input-row">
              <input
                id="pairing-code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="Paste the key from remotty pair"
                autoCapitalize="none"
                autoComplete="one-time-code"
                maxLength={128}
                autoFocus
              />
              <button type="button" className="scan-button" title="Scan pairing QR code" aria-label="Scan pairing QR code" onClick={() => setScannerOpen(true)}><ScanLine size={20} /></button>
              <button type="submit" className="primary-button" aria-label="Connect remotty"><ChevronRight size={20} /></button>
            </div>
            {error && <p className="form-error">{error}</p>}
          </form>
        </div>

        <div className="install-sequence">
          <div className="install-heading"><Terminal size={18} /><span>Install and pair</span></div>
          <div className="install-step"><b>01</b><div><span>Add the OpenCode plugin</span><code>{`"plugin": ["opencode-remotty"]`}</code><small>~/.config/opencode/opencode.json</small></div></div>
          <div className="install-step"><b>02</b><div><span>Create a 256-bit pairing key</span><code>{`npx opencode-remotty pair --broker ${broker}`}</code></div></div>
          <div className="install-step"><b>03</b><div><span>Restart OpenCode, then paste the key here</span><code>opencode --continue</code></div></div>
        </div>
      </section>

      <section className="feature-band">
        <div><Database size={18} /><strong>No chat storage</strong><span>Messages pass through the broker and are discarded.</span></div>
        <div><Smartphone size={18} /><strong>Native Push</strong><span>Receive questions and permission actions while the PWA is closed.</span></div>
        <div><ShieldCheck size={18} /><strong>Approval controls</strong><span>Review the exact command before Reject, Once, or Always.</span></div>
      </section>
      {scannerOpen && (
        <PairingScanner
          onClose={() => setScannerOpen(false)}
          onScan={(credential) => {
            setCode(credential)
            setScannerOpen(false)
            onConnect(credential)
          }}
        />
      )}
    </main>
  )
}

function PairingScanner({ onScan, onClose }: { onScan: (credential: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string>()

  useEffect(() => {
    let controls: IScannerControls | undefined
    let cancelled = false
    void import("@zxing/browser").then(({ BrowserQRCodeReader }) => {
      if (cancelled) return
      const reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 150 })
      return reader.decodeFromVideoDevice(undefined, videoRef.current ?? undefined, (result, _error, scannerControls) => {
        controls = scannerControls
        if (!result || cancelled) return
        const credential = pairingCredentialFrom(result.getText())
        if (!credential) {
          setError("This QR code does not contain a remotty pairing key.")
          return
        }
        scannerControls.stop()
        onScan(credential)
      })
    }).then((scannerControls) => {
      if (!scannerControls) return
      controls = scannerControls
      if (cancelled) scannerControls.stop()
    }).catch(() => setError("Camera access is unavailable. Check the browser permission."))

    return () => {
      cancelled = true
      controls?.stop()
    }
  }, [onScan])

  return (
    <div className="scanner-overlay" role="dialog" aria-modal="true" aria-label="Scan pairing QR code">
      <section className="scanner-panel">
        <header><span><ScanLine size={18} /> Scan pairing QR</span><button className="icon-button" title="Close scanner" onClick={onClose}><X size={19} /></button></header>
        <div className="scanner-view"><video ref={videoRef} muted playsInline /><span className="scanner-frame" /></div>
        {error && <p className="form-error">{error}</p>}
      </section>
    </div>
  )
}

function SessionRow({ session, needsInput, selected, onSelect }: { session: SessionSummary; needsInput: boolean; selected: boolean; onSelect: () => void }) {
  return (
    <button className={`session-row ${selected ? "selected" : ""}`} onClick={onSelect}>
      <span className={`status-dot ${needsInput ? "needs-input" : session.status}`} />
      <span className="session-copy">
        <strong>{session.title}</strong>
        <span><GitBranch size={13} /><i>{session.branch ?? "no branch"}</i></span>
        <span><Folder size={13} /><i>{session.directory}</i></span>
      </span>
      <span className="session-meta">
        <time>{relativeTime(session.updatedAt)}</time>
        <span className="diff-count"><b>+{session.additions}</b> <i>-{session.deletions}</i></span>
      </span>
      <ChevronRight size={17} />
    </button>
  )
}

function SessionDetail({
  session,
  agents,
  revision,
  permission,
  question,
  request,
  onBack,
  onError,
}: {
  session: SessionSummary
  agents: AgentSummary[]
  revision: number
  permission?: PermissionRequest
  question?: QuestionRequest
  request: (command: any) => Promise<unknown>
  onBack: () => void
  onError: (error?: string) => void
}) {
  const [messages, setMessages] = useState<SessionMessage[]>([])
  const [diffs, setDiffs] = useState<FileDiff[]>([])
  const [todos, setTodos] = useState<SessionTodo[]>([])
  const [prompt, setPrompt] = useState("")
  const [sending, setSending] = useState(false)
  const [tab, setTab] = useState<"activity" | "todos" | "changes">("activity")
  const [agent, setAgent] = useState(session.agent ?? agents[0]?.name ?? "")
  const [agentMenuOpen, setAgentMenuOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const detailContentRef = useRef<HTMLDivElement>(null)

  const refresh = async () => {
    try {
      const [messageResult, todoResult, diffResult] = await Promise.all([
        request({ type: "session.messages", sessionId: session.id }),
        request({ type: "session.todos", sessionId: session.id }),
        request({ type: "session.diff", sessionId: session.id }),
      ])
      setMessages(Array.isArray(messageResult) ? (messageResult as SessionMessage[]) : [])
      setTodos(Array.isArray(todoResult) ? (todoResult as SessionTodo[]) : [])
      setDiffs(Array.isArray(diffResult) ? (diffResult as FileDiff[]) : [])
    } catch (error) {
      onError((error as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setAgent(session.agent ?? agents[0]?.name ?? "")
  }, [session.id, session.agent, agents])

  useEffect(() => {
    const timeout = window.setTimeout(() => void refresh(), revision ? 350 : 0)
    return () => window.clearTimeout(timeout)
  }, [session.id, session.status, revision])

  const visibleMessages = useMemo(
    () => messages.filter((message) => message.parts.some((part) => part.type === "text" || part.type === "tool")),
    [messages],
  )
  const activeTool = useMemo(
    () =>
      visibleMessages
        .flatMap((message) => message.parts)
        .filter(
          (part) =>
            part.type === "tool" && (part.state?.status === "pending" || part.state?.status === "running"),
        )
        .at(-1),
    [visibleMessages],
  )

  useLayoutEffect(() => {
    if (tab !== "activity") return
    const frame = requestAnimationFrame(() => {
      if (detailContentRef.current) detailContentRef.current.scrollTop = detailContentRef.current.scrollHeight
    })
    return () => cancelAnimationFrame(frame)
  }, [tab, visibleMessages, revision])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!prompt.trim() || sending) return
    setSending(true)
    try {
      await request({
        type: "session.prompt",
        sessionId: session.id,
        text: prompt,
        agent: agent || undefined,
      })
      setPrompt("")
    } catch (error) {
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

  return (
    <div className="session-detail">
      <header className="detail-header">
        <button className="icon-button back-button" title="Back" onClick={onBack}><ArrowLeft size={20} /></button>
        <div>
          <div className="title-line"><span className={`status-dot ${session.status}`} /><h2>{session.title}</h2></div>
          <p>{session.directory}</p>
        </div>
        <div className="detail-actions">
          <div className="agent-control">
            <button
              type="button"
              className="agent-picker"
              aria-haspopup="listbox"
              aria-expanded={agentMenuOpen}
              onClick={() => setAgentMenuOpen((open) => !open)}
            >
              <Bot size={15} />
              <span>{agent || "Select agent"}</span>
              <ChevronDown size={14} />
            </button>
            {agentMenuOpen && (
              <div className="agent-menu" role="listbox">
                {agents.map((item) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={item.name === agent}
                    className={item.name === agent ? "selected" : ""}
                    key={item.name}
                    onClick={() => { setAgent(item.name); setAgentMenuOpen(false) }}
                  >
                    <span className="agent-color" style={{ background: item.color ?? "var(--cyan)" }} />
                    <span><strong>{item.name}</strong>{item.description && <small>{item.description}</small>}</span>
                    {item.name === agent && <Check size={14} />}
                  </button>
                ))}
              </div>
            )}
          </div>
          {session.status === "busy" && (
            <button
              className="danger-button"
              title="Stop agent"
              onClick={() => void request({ type: "session.abort", sessionId: session.id }).catch((error) => onError(error.message))}
            >
              <CircleStop size={17} /> Stop
            </button>
          )}
        </div>
      </header>

      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "activity"} className={tab === "activity" ? "active" : ""} onClick={() => setTab("activity")}>Activity</button>
        <button type="button" role="tab" aria-selected={tab === "todos"} className={tab === "todos" ? "active" : ""} onClick={() => { setTab("todos"); void refresh() }}>Todos <span>{todos.filter((todo) => todo.status !== "completed" && todo.status !== "cancelled").length}</span></button>
        <button type="button" role="tab" aria-selected={tab === "changes"} className={tab === "changes" ? "active" : ""} onClick={() => { setTab("changes"); void refresh() }}>Changes <span>{diffs.length}</span></button>
      </div>

      <div className="detail-content" ref={detailContentRef}>
        {tab === "activity" ? (
          <div className="message-list">
            {loading ? (
              <div className="empty-state"><LoaderCircle className="spin" size={22} /></div>
            ) : (
              <>
                {visibleMessages.map((message) => <Message key={message.info.id} message={message} />)}
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
        ) : (
          <div className="change-list">
            {diffs.map((diff) => (
              <div className="change-row" key={diff.file}>
                <code>{diff.file}</code>
                <span><b>+{diff.additions}</b><i>-{diff.deletions}</i></span>
              </div>
            ))}
            {diffs.length === 0 && <div className="empty-state"><p>No tracked changes reported for {session.directory}.</p></div>}
          </div>
        )}
      </div>

      <div className="input-dock">
        {permission && <PermissionPanel permission={permission} request={request} onError={onError} />}
        {question && <QuestionPanel requestInfo={question} request={request} onError={onError} />}
        {session.status === "busy" && (
          <div className="work-strip" role="status">
            <span className="work-pulse"><i /><i /><i /></span>
            <strong>{activeTool?.state?.title ?? "Thinking"}</strong>
          </div>
        )}
        <form className="composer" onSubmit={submit}>
          <textarea
            ref={promptRef}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={handlePromptKeyDown}
            placeholder={session.status === "idle" ? "Ask OpenCode to continue..." : "Send another instruction..."}
            rows={1}
            aria-label="Message OpenCode"
          />
          <button className="primary-button" type="submit" disabled={!prompt.trim() || sending} aria-label="Send prompt">
            {sending ? <LoaderCircle className="spin" size={19} /> : <Send size={19} />}
          </button>
        </form>
      </div>
    </div>
  )
}

function QuestionPanel({ requestInfo, request, onError }: { requestInfo: QuestionRequest; request: (command: any) => Promise<unknown>; onError: (error?: string) => void }) {
  const [answers, setAnswers] = useState<string[][]>(() => requestInfo.questions.map(() => []))

  const toggle = (questionIndex: number, label: string, multiple?: boolean) => {
    setAnswers((current) => current.map((answer, index) => {
      if (index !== questionIndex) return answer
      if (!multiple) return [label]
      return answer.includes(label) ? answer.filter((item) => item !== label) : [...answer, label]
    }))
  }

  const submit = () => {
    if (answers.some((answer) => answer.length === 0)) {
      onError("Answer each question before you continue.")
      return
    }
    void request({ type: "question.reply", sessionId: requestInfo.sessionID, questionId: requestInfo.id, answers }).catch((error) => onError(error.message))
  }

  return (
    <section className="question-panel">
      <div className="question-title"><CircleHelp size={20} /><strong>OpenCode needs input</strong></div>
      {requestInfo.questions.map((question, questionIndex) => (
        <div className="question-block" key={`${requestInfo.id}-${questionIndex}`}>
          <span>{question.header}</span>
          <p>{question.question}</p>
          <div className="option-list">
            {question.options.map((option) => (
              <button
                className={answers[questionIndex]?.includes(option.label) ? "selected" : ""}
                key={option.label}
                title={option.description}
                onClick={() => toggle(questionIndex, option.label, question.multiple)}
              >
                {answers[questionIndex]?.includes(option.label) && <Check size={14} />}
                {option.label}
              </button>
            ))}
          </div>
          {question.custom !== false && (
            <input
              aria-label={`Custom answer for ${question.header}`}
              placeholder="Type another answer"
              onChange={(event) => setAnswers((current) => current.map((answer, index) => index === questionIndex ? (event.target.value ? [event.target.value] : []) : answer))}
            />
          )}
        </div>
      ))}
      <div className="question-actions">
        <button onClick={() => void request({ type: "question.reject", sessionId: requestInfo.sessionID, questionId: requestInfo.id }).catch((error) => onError(error.message))}>Dismiss</button>
        <button className="confirm" onClick={submit}>Continue <ChevronRight size={16} /></button>
      </div>
    </section>
  )
}

function PermissionPanel({ permission, request, onError }: { permission: PermissionRequest; request: (command: any) => Promise<unknown>; onError: (error?: string) => void }) {
  const reply = (response: "once" | "always" | "reject") =>
    request({
      type: "permission.reply",
      sessionId: permission.sessionID,
      permissionId: permission.id,
      response,
    }).catch((error) => onError(error.message))

  return (
    <section className="permission-panel">
      <ShieldAlert size={20} />
      <div className="permission-copy">
        <strong>{permission.permission}</strong>
        <div className="permission-patterns">
          {permission.patterns.map((pattern) => <code key={pattern}>{pattern}</code>)}
        </div>
        {typeof permission.metadata.description === "string" && (
          <small className="permission-description">{permission.metadata.description}</small>
        )}
      </div>
      <div className="permission-actions">
        <button title="Reject" onClick={() => void reply("reject")}><X size={17} /></button>
        <button onClick={() => void reply("once")}><Check size={17} /> Once</button>
        <button onClick={() => void reply("always")}><Check size={17} /> Always</button>
      </div>
    </section>
  )
}

function Message({ message }: { message: SessionMessage }) {
  const isUser = message.info.role === "user"
  return (
    <article className={`message ${message.info.role}`} aria-label={isUser ? "Your message" : "OpenCode response"}>
      <div className="message-frame">
        <span className="message-sigil" aria-hidden="true">
          {isUser ? <UserRound size={15} /> : <Code2 size={16} />}
        </span>
        <div className="message-body">
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
              return <div className="tool-line" key={index}><Code2 size={15} /><span>{part.state?.title ?? part.tool}</span><small>{part.state?.status}</small></div>
            }
            return null
          })}
        </div>
      </div>
    </article>
  )
}

const relativeTime = (time: number) => {
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1_000))
  if (seconds < 60) return "now"
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h`
  return `${Math.floor(seconds / 86_400)}d`
}

const folderName = (directory: string) => directory.split(/[\\/]/).filter(Boolean).at(-1) ?? directory
