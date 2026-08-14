import { FormEvent, KeyboardEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bell,
  BellOff,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  CircleStop,
  CircleHelp,
  Code2,
  Database,
  Folder,
  Github,
  GitBranch,
  KeyRound,
  Laptop,
  LockKeyhole,
  LoaderCircle,
  LogOut,
  Plus,
  ShieldCheck,
  Terminal,
  Unplug,
  RefreshCw,
  ScanLine,
  Send,
  ShieldAlert,
  Smartphone,
  UserRound,
  Wifi,
  WifiOff,
  X,
} from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { useRegisterSW } from "virtual:pwa-register/react"
import type { AgentSummary, PairingBundle, PermissionRequest, QuestionRequest, RelayInfo, SessionSummary } from "@remotty/protocol"
import { CURRENT_IDENTITY_MARKER, loadCurrentIdentity } from "./deviceStore"
import { useRelay } from "./useRelay"
import { pairingBundleFrom, routeForEnrollment, routeForStoredIdentity } from "./pairing"
import { NOTIFICATION_PROMPT_SEEN, shouldOfferPushNotifications } from "./notificationPrompt"
import { relaySupportsSessionCreate, stableWorkspaceKey, visibleSubagents, workspaceSessionKey, type RoutedSession, type RoutedSubagent } from "./relayState"
import { connectionLabel, mergeByMessageId, promptDeliveryState } from "./resilience"
import { commitManifestForRefresh, emptyMessageCache, messageInventory, migrateMessageCache, replaceCanonicalMessages, stageMessage, visibleCachedMessages, type MessageCache } from "./messageCache"
import { clearSubmittedDraft, resourceArray, retainedSessionState, type SessionResourceRevisions } from "./sessionState"
import { SubagentActivity } from "./SubagentActivity"

type MessagePart = {
  type: string
  text?: string
  tool?: string
  time?: { start?: number; end?: number }
  state?: {
    status?: string
    title?: string
    input?: Record<string, unknown>
    output?: string
    error?: string
    metadata?: Record<string, unknown>
  }
}
type SessionMessage = { info: { id: string; role: string; parentID?: string; time?: { created?: number }; delivery?: "sending" | "queued" | "accepted" | "uncertain" | "failed"; legacyPrompt?: boolean; knownMessageIds?: string[] }; parts: MessagePart[] }
type FileDiff = {
  file: string
  status?: "added" | "modified" | "deleted" | "untracked"
  additions: number
  deletions: number
  patch?: string
  binary?: boolean
  truncated?: boolean
}
type WorkspaceDiff = { state: "ok" | "not_git"; files: FileDiff[]; truncated: boolean }
type WorkspacePatch = { patch?: string; truncated: boolean }
type SessionTodo = { id: string; content: string; status: string; priority: string }

let routePairingBundle = location.pathname === "/pair" && location.hash
  ? pairingBundleFrom(location.href)
  : undefined
if (routePairingBundle) history.replaceState({}, "", "/pair")

export function App() {
  const [pairingBundle] = useState(routePairingBundle)
  const [homeReady, setHomeReady] = useState(
    () => location.pathname !== "/" || !localStorage.getItem(CURRENT_IDENTITY_MARKER),
  )
  useEffect(() => {
    routePairingBundle = undefined
  }, [])
  useEffect(() => {
    if (homeReady || location.pathname !== "/") return
    let active = true
    void loadCurrentIdentity().then((identity) => {
      if (!active) return
      const route = routeForStoredIdentity(location.pathname, identity?.enrolled === true)
      if (route !== location.pathname) history.replaceState({}, "", route)
      setHomeReady(true)
    }).catch(() => {
      if (active) setHomeReady(true)
    })
    return () => { active = false }
  }, [homeReady])
  if (!homeReady) return <PwaUpdatePrompt />
  const page = location.pathname === "/" ? <LandingPage />
    : location.pathname === "/privacy" ? <PrivacyPage />
    : <RelayApp initialBundle={pairingBundle} />
  return <>{page}<PwaUpdatePrompt /></>
}

function PwaUpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()
  const [updating, setUpdating] = useState(false)
  const paired = Boolean(localStorage.getItem(CURRENT_IDENTITY_MARKER))
  if (!needRefresh || location.pathname === "/pair" || (location.pathname !== "/app" && !paired)) return null

  const update = async () => {
    setUpdating(true)
    try {
      await updateServiceWorker(true)
    } finally {
      setUpdating(false)
    }
  }

  return (
    <div className="notification-prompt-overlay" role="presentation">
      <section className="notification-prompt update-prompt" role="dialog" aria-modal="true" aria-labelledby="pwa-update-title">
        <span className="notification-prompt-icon"><RefreshCw size={24} /></span>
        <p>Update available</p>
        <h2 id="pwa-update-title">A new Remotty version is ready.</h2>
        <span>Update now to reload the PWA. To update later, close every Remotty tab and installed app window, then reopen it.</span>
        <strong>Update the desktop plugin too:</strong>
        <code>opencode plugin opencode-remotty --global --force</code>
        <div>
          <button className="notification-secondary" disabled={updating} onClick={() => setNeedRefresh(false)}>Later</button>
          <button className="notification-primary" disabled={updating} onClick={() => void update()}>{updating ? <LoaderCircle className="spin" size={17} /> : <RefreshCw size={17} />} Update now</button>
        </div>
      </section>
    </div>
  )
}

function RelayApp({ initialBundle }: { initialBundle?: PairingBundle }) {
  const relayState = useRelay(initialBundle)
  const [connectionDetailsOpen, setConnectionDetailsOpen] = useState(false)
  const connectionTriggerRef = useRef<HTMLButtonElement>(null)
  const [newSessionOpen, setNewSessionOpen] = useState(false)
  const newSessionTriggerRef = useRef<HTMLButtonElement>(null)
  const [focusSessionKey, setFocusSessionKey] = useState<string>()
  const [selectedKey, setSelectedKey] = useState<string | undefined>(
    () => new URLSearchParams(location.search).get("session") ?? undefined,
  )
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set())
  const [notificationPromptOpen, setNotificationPromptOpen] = useState(false)
  const [enablingNotifications, setEnablingNotifications] = useState(false)
  const [, setClock] = useState(0)
  const sessionKey = (session: SessionSummary & { workspaceRelayId?: string; workspaceId?: string }) => `${session.workspaceId ?? session.workspaceRelayId ?? ""}:${session.id}`
  const selected = relayState.sessions.find((session) =>
    sessionKey(session) === selectedKey || `${session.workspaceRelayId}:${session.id}` === selectedKey || (!selectedKey?.includes(":") && session.id === selectedKey),
  )
  const loadSelectedCache = useCallback(<T,>(resource: string) => selected
    ? relayState.loadCache<T>(selected.workspaceRelayId, resource, selected.id)
    : Promise.resolve(undefined), [relayState.loadCache, selected?.workspaceRelayId, selected?.id])
  const saveSelectedCache = useCallback(<T,>(resource: string, value: T) => selected
    ? relayState.saveCache(selected.workspaceRelayId, resource, value, selected.id)
    : Promise.resolve(), [relayState.saveCache, selected?.workspaceRelayId, selected?.id])
  const sessionGroups = useMemo(() => {
    const groups = new Map<string, RoutedSession[]>()
    for (const session of relayState.sessions) {
      const group = groups.get(session.directory)
      if (group) group.push(session)
      else groups.set(session.directory, [session])
    }
    return [...groups.entries()].sort(
      ([, left], [, right]) => Math.max(...right.map((session) => session.updatedAt)) - Math.max(...left.map((session) => session.updatedAt)),
    )
  }, [relayState.sessions])
  const attentionKeys = useMemo(() => new Set([
    ...relayState.permissions.map((item) => `${item.workspaceRelayId}:${item.sessionID}`),
    ...relayState.questions.map((item) => `${item.workspaceRelayId}:${item.sessionID}`),
  ]), [relayState.permissions, relayState.questions])

  useEffect(() => {
    if (!relayState.error) return
    const timeout = window.setTimeout(() => relayState.setError(undefined), 6_000)
    return () => window.clearTimeout(timeout)
  }, [relayState.error])
  useEffect(() => {
    const timer = window.setInterval(() => setClock((value) => value + 1), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const supported = "Notification" in window && "serviceWorker" in navigator && "PushManager" in window
    const permission = supported ? Notification.permission : "unsupported"
    if (shouldOfferPushNotifications({
      connected: relayState.connection === "online",
      hasRelay: Boolean(relayState.relay),
      enabled: relayState.notificationsEnabled,
      supported,
      permission,
      seen: localStorage.getItem(NOTIFICATION_PROMPT_SEEN) === "true",
    })) setNotificationPromptOpen(true)
  }, [relayState.connection, relayState.relay, relayState.notificationsEnabled])

  const closeNotificationPrompt = () => {
    localStorage.setItem(NOTIFICATION_PROMPT_SEEN, "true")
    setNotificationPromptOpen(false)
  }
  const closeConnectionDetails = useCallback(() => {
    setConnectionDetailsOpen(false)
    requestAnimationFrame(() => connectionTriggerRef.current?.focus())
  }, [])
  const closeNewSession = useCallback(() => {
    setNewSessionOpen(false)
    requestAnimationFrame(() => newSessionTriggerRef.current?.focus())
  }, [])
  const createSession = useCallback(async (relayId: string) => {
    const relay = relayState.relays.find((candidate) => candidate.id === relayId)
    if (!relay) throw new Error("The selected workspace is unavailable.")
    const result = await relayState.request({ type: "session.create" }, relayId) as { sessionId?: unknown }
    if (typeof result?.sessionId !== "string" || !result.sessionId) throw new Error("The relay returned an invalid session.")
    const key = `${stableWorkspaceKey(relay)}:${result.sessionId}`
    setFocusSessionKey(key)
    setSelectedKey(key)
    setNewSessionOpen(false)
  }, [relayState.relays, relayState.request])
  const toggleGroup = (directory: string) => setCollapsedGroups((current) => {
    const next = new Set(current)
    if (next.has(directory)) next.delete(directory)
    else next.add(directory)
    return next
  })

  useEffect(() => {
    const route = routeForEnrollment(relayState.enrolled)
    if (route && location.pathname !== route) history.replaceState({}, "", route)
  }, [relayState.enrolled])

  if (relayState.enrolled !== true &&
    (location.pathname === "/pair" || (relayState.connection === "disconnected" && !relayState.relay))) {
    return (
      <PairingScreen
        onConnect={(bundle) => {
          localStorage.removeItem(NOTIFICATION_PROMPT_SEEN)
          void relayState.connect(bundle)
        }}
        error={relayState.error}
      />
    )
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark"><Code2 size={18} /></span>
          <strong>remotty</strong>
        </div>
        <div className={`connection-state ${relayState.connection}`}>
          <button ref={connectionTriggerRef} className="connection-button" onClick={() => setConnectionDetailsOpen(true)} aria-haspopup="dialog" aria-expanded={connectionDetailsOpen} aria-controls="connection-status-dialog">
            {relayState.connection === "online" ? <Wifi size={15} /> : <WifiOff size={15} />}
            {connectionLabel(relayState.connection, relayState.relays.length, Object.values(relayState.relayHealth).some((health) => health.timedOut))}
          </button>
          <a className="notification-button" title="View source" aria-label="View source" href="https://github.com/d3vv3/remotty" target="_blank" rel="noreferrer"><Github size={15} /></a>
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
            <button className="icon-button" title="Disconnect" onClick={() => { history.replaceState({}, "", "/pair"); relayState.disconnect() }}><LogOut size={18} /></button>
          </section>

          <div className="section-heading">
            <span>Sessions</span>
            <div className="section-actions">
              <button
                ref={newSessionTriggerRef}
                className="icon-button"
                title="New session"
                aria-label="New session"
                onClick={() => setNewSessionOpen(true)}
              >
                <Plus size={18} />
              </button>
              <button
                className="icon-button"
                title="Refresh sessions"
                onClick={() => void relayState.request({ type: "snapshot.request" })}
                disabled={relayState.connection !== "online"}
              >
                <RefreshCw size={17} />
              </button>
            </div>
          </div>
          <div className="session-legend" aria-label="Session status colors">
            <span><i className="status-dot idle" />Finished</span>
            <span><i className="status-dot busy" />Working</span>
            <span><i className="status-dot needs-input" />Needs attention</span>
            <span><i className="status-dot error" />Offline</span>
          </div>

          <div className="session-list">
            {sessionGroups.map(([directory, sessions]) => (
              <section className="workspace-group" key={directory}>
                <button className="workspace-heading" title={directory} aria-expanded={!collapsedGroups.has(directory)} onClick={() => toggleGroup(directory)}>
                  <Folder size={14} />
                  <span><strong>{folderName(directory)}</strong><small>{directory}</small></span>
                  <b>{sessions.length}</b><ChevronDown className={collapsedGroups.has(directory) ? "collapsed" : ""} size={16} />
                </button>
                {!collapsedGroups.has(directory) && sessions.map((session) => (
                  <SessionRow
                    key={sessionKey(session)}
                    session={session}
                    selected={sessionKey(session) === selectedKey}
                    needsInput={attentionKeys.has(`${session.workspaceRelayId}:${session.id}`)}
                    offline={!relayState.isRelayConnected(session.workspaceRelayId)}
                    onSelect={() => { relayState.setError(undefined); setSelectedKey(sessionKey(session)) }}
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
              key={sessionKey(selected)}
              session={selected}
              sessionKey={sessionKey(selected)}
              agents={relayState.agents.filter((agent) => agent.workspaceRelayId === selected.workspaceRelayId)}
              revision={relayState.sessionRevisions[sessionKey(selected)] ?? 0}
              resourceRevisions={relayState.resourceRevisions[sessionKey(selected)] ?? { messages: 0, todos: 0, diffs: 0 }}
              subagents={relayState.subagentsByRoot.get(sessionKey(selected)) ?? []}
              subagentRevisions={Object.fromEntries((relayState.subagentsByRoot.get(sessionKey(selected)) ?? []).map((child) => [child.id, relayState.resourceRevisions[workspaceSessionKey(child.workspaceId, child.id)]?.messages ?? 0]))}
              supportsSubagents={relayState.relays.find((relay) => relay.id === selected.workspaceRelayId)?.capabilities?.subagents === 1}
              permission={relayState.permissions.find((permission) => permission.sessionID === selected.id && permission.workspaceRelayId === selected.workspaceRelayId)}
              question={relayState.questions.find((question) => question.sessionID === selected.id && question.workspaceRelayId === selected.workspaceRelayId)}
              request={(command, progress) => relayState.request(command, selected.workspaceRelayId, progress as ((messages: unknown[]) => void) | undefined)}
              loadCache={loadSelectedCache}
              saveCache={saveSelectedCache}
              onBack={() => setSelectedKey(undefined)}
              onError={relayState.setError}
              focusPrompt={focusSessionKey === sessionKey(selected)}
              onPromptFocused={() => setFocusSessionKey(undefined)}
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
        <div className="toast" role="alert"><AlertTriangle size={17} /><span>{relayState.error}</span><button title="Dismiss error" onClick={() => relayState.setError(undefined)}><X size={16} /></button></div>
      )}
      {connectionDetailsOpen && <ConnectionDetails relayState={relayState} onClose={closeConnectionDetails} />}
      {newSessionOpen && <NewSessionDialog relays={relayState.relays} isConnected={relayState.isRelayConnected} onCreate={createSession} onClose={closeNewSession} />}
      {notificationPromptOpen && (
        <div className="notification-prompt-overlay" role="presentation">
          <section className="notification-prompt" role="dialog" aria-modal="true" aria-labelledby="notification-prompt-title">
            <button className="icon-button notification-prompt-close" title="Not now" aria-label="Close notification prompt" onClick={closeNotificationPrompt}><X size={18} /></button>
            <span className="notification-prompt-icon"><Bell size={24} /></span>
            <p>Stay in the loop</p>
            <h2 id="notification-prompt-title">Enable Push notifications?</h2>
            <span>Get an alert when an agent finishes, asks a question, or needs approval.</span>
            <div>
              <button className="notification-secondary" onClick={closeNotificationPrompt}>Not now</button>
              <button
                className="notification-primary"
                disabled={enablingNotifications}
                onClick={() => {
                  setEnablingNotifications(true)
                  void relayState.toggleNotifications().finally(() => {
                    setEnablingNotifications(false)
                    closeNotificationPrompt()
                  })
                }}
              >{enablingNotifications ? <LoaderCircle className="spin" size={17} /> : <Bell size={17} />} Enable Push</button>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}

const publicFeatures = [
  { icon: Bell, title: "Actionable Push notifications", copy: "Get completion, permission, and question alerts. Approve once, always, or reject without opening the PWA." },
  { icon: ShieldCheck, title: "Approval controls", copy: "Read the requested command and its patterns before you grant access." },
  { icon: Terminal, title: "Tool details", copy: "Expand tool calls to inspect inputs, outputs, errors, and readable edit diffs." },
  { icon: Smartphone, title: "Installable PWA", copy: "Use the full mobile interface from your home screen without an app-store install." },
  { icon: Database, title: "No chat storage", copy: "The broker keeps routing state in memory and does not persist your session messages." },
  { icon: Unplug, title: "No inbound port", copy: "The local plugin opens an outbound WSS connection. You do not expose the OpenCode web server or change firewall rules." },
]

function PublicBrand() {
  return (
    <a className="flex items-center gap-3 font-mono text-sm font-bold text-[#f4f2eb] no-underline" href="/">
      <span className="grid size-9 -rotate-3 place-items-center rounded-sm border border-[#efff91] bg-[#d8ff3e] text-[#080909] shadow-[4px_4px_0_#42e8d4]"><Code2 size={18} /></span>
      remotty
    </a>
  )
}

function PhonePreview() {
  return (
    <div className="relative h-[570px] w-[292px] rounded-[38px] border-[10px] border-[#202526] bg-[#090a0b] p-1 shadow-[18px_22px_0_#00000080]" aria-label="remotty mobile application preview">
      <span className="absolute left-1/2 top-2 z-10 h-5 w-24 -translate-x-1/2 rounded-b-xl bg-[#202526]" />
      <div className="flex h-full flex-col overflow-hidden rounded-[25px] border border-[#3a4140] bg-[#090a0b]">
        <div className="flex h-8 shrink-0 items-center justify-between bg-[#111415] px-4 pt-1 font-mono text-[8px] text-[#8d9692]"><span>9:41</span><span className="text-[#73e08c]">● live</span></div>
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-[#3a4140] bg-[#0b0d0e] px-3"><PublicBrand /><Bell size={14} className="text-[#d8ff3e]" /></div>
        <div className="border-b border-[#292d2d] bg-[#101213] p-3">
          <div className="flex items-center justify-between"><div><strong className="font-mono text-[11px]">Ship pairing routes</strong><p className="mt-1 font-mono text-[7px] text-[#8d9692]">/projects/remotty</p></div><span className="size-2 rounded-full bg-[#ffbd4a]" /></div>
        </div>
        <div className="flex h-9 shrink-0 items-end gap-1 border-b border-[#292d2d] bg-[#0e1011] px-3"><span className="border-b-2 border-[#d8ff3e] px-2 pb-2 font-mono text-[8px] uppercase text-[#d8ff3e]">Activity</span><span className="px-2 pb-2 font-mono text-[8px] uppercase text-[#8d9692]">Todos 3</span><span className="px-2 pb-2 font-mono text-[8px] uppercase text-[#8d9692]">Changes 4</span></div>
        <div className="min-h-0 flex-1 space-y-3 overflow-hidden p-3">
          <div className="ml-auto max-w-[80%] border-r-2 border-[#ff635d] bg-[#181415] p-3 text-[9px] leading-4 text-[#ffecea]">Split the landing from pairing and show the full feature set.</div>
          <div className="border-l-[3px] border-[#d8ff3e] bg-[#131617] p-3 text-[9px] leading-4 text-[#dfe6e2]">I updated the routes and kept the installed PWA focused on active sessions.</div>
          <div className="flex items-center gap-2 border border-[#42e8d455] bg-[#071817] p-2 font-mono text-[8px] text-[#42e8d4]"><Terminal size={12} /><span className="min-w-0 flex-1 truncate">Update app routing</span><span className="text-[#73e08c]">done</span></div>
          <div className="flex items-center gap-2 border border-[#42e8d455] bg-[#071817] p-2 font-mono text-[8px] text-[#42e8d4]"><Code2 size={12} /><span className="min-w-0 flex-1 truncate">Build responsive landing</span><span className="text-[#ffbd4a]">running</span></div>
        </div>
        <div className="flex h-8 shrink-0 items-center gap-2 border-t border-[#d8ff3e33] bg-[#121609] px-3 font-mono text-[8px] uppercase text-[#d8ff3e]"><span className="size-2 animate-pulse rounded-full bg-[#d8ff3e]" /> Working</div>
        <div className="grid shrink-0 grid-cols-[1fr_34px] gap-2 border-t border-[#3a4140] bg-[#0d0f10] p-2"><span className="flex h-9 items-center border border-[#3a4140] bg-[#171a1b] px-2 font-mono text-[8px] text-[#68706d]">Send another instruction...</span><span className="grid size-9 place-items-center rounded-sm bg-[#d8ff3e] text-[#080909]"><Send size={14} /></span></div>
      </div>
    </div>
  )
}

function PrivacyPage() {
  useEffect(() => {
    const previous = document.title
    document.title = "Privacy | remotty"
    return () => { document.title = previous }
  }, [])

  return (
    <main className="h-dvh overflow-y-auto bg-[#090a0b] text-[#f4f2eb] selection:bg-[#d8ff3e] selection:text-[#090a0b]">
      <header className="sticky top-0 z-30 border-b border-[#292d2d] bg-[#090a0bf2]">
        <nav className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5 sm:px-8">
          <PublicBrand />
          <a className="inline-flex h-10 items-center gap-2 rounded-sm border border-[#3a4140] px-4 font-mono text-[10px] font-bold uppercase text-[#b5bdb9] hover:border-[#42e8d4] hover:text-[#42e8d4]" href="/"><ArrowLeft size={15} /> Home</a>
        </nav>
      </header>

      <section className="border-b border-[#2b5551] bg-[#0b1514] py-20">
        <div className="mx-auto w-full max-w-6xl px-5 sm:px-8">
          <p className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase text-[#42e8d4]"><LockKeyhole size={15} /> Privacy design</p>
          <h1 className="mt-5 max-w-4xl font-mono text-4xl font-bold leading-tight sm:text-6xl">Your OpenCode content stays between your devices.</h1>
          <p className="mt-7 max-w-3xl text-sm leading-7 text-[#9eb8b4]">remotty uses end-to-end encryption. The hosted broker routes ciphertext and keeps no chat history. You can verify the design in the public source.</p>
        </div>
      </section>

      <section className="border-b border-[#292d2d] bg-[#0d1011] py-16">
        <div className="mx-auto w-full max-w-6xl px-5 sm:px-8">
          <p className="font-mono text-[10px] font-bold uppercase text-[#ff635d]">How it works</p>
          <h2 className="mt-3 font-mono text-3xl font-bold sm:text-4xl">Encryption starts before the network.</h2>
          <div className="mt-10 grid border-y border-[#3a4140] md:grid-cols-3">
            <div className="border-b border-[#292d2d] py-7 md:border-b-0 md:border-r md:pr-8"><b className="font-mono text-xs text-[#ff635d]">01</b><h3 className="mt-4 font-mono text-sm font-bold">Create local keys</h3><p className="mt-4 text-xs leading-6 text-[#8d9692]">The OpenCode plugin creates relay keys. Each browser creates separate device keys during a ten-minute, one-time enrollment.</p></div>
            <div className="border-b border-[#292d2d] py-7 md:border-b-0 md:border-r md:px-8"><b className="font-mono text-xs text-[#ff635d]">02</b><h3 className="mt-4 font-mono text-sm font-bold">Encrypt and sign</h3><p className="mt-4 text-xs leading-6 text-[#8d9692]">P-256 key agreement and HKDF derive AES-256-GCM keys. Signed commands bind every action to an enrolled device.</p></div>
            <div className="py-7 md:pl-8"><b className="font-mono text-xs text-[#ff635d]">03</b><h3 className="mt-4 font-mono text-sm font-bold">Route ciphertext</h3><p className="mt-4 text-xs leading-6 text-[#8d9692]">The broker forwards encrypted frames. It cannot read sessions, tool output, questions, approvals, prompts, or notification text.</p></div>
          </div>
        </div>
      </section>

      <section className="border-b border-[#292d2d] bg-[#090a0b] py-16">
        <div className="mx-auto grid w-full max-w-6xl gap-12 px-5 sm:px-8 lg:grid-cols-[.75fr_1.25fr]">
          <div><p className="font-mono text-[10px] font-bold uppercase text-[#42e8d4]">Data handling</p><h2 className="mt-3 font-mono text-3xl font-bold sm:text-4xl">What is stored and seen.</h2></div>
          <div className="border-t border-[#3a4140]">
            <div className="grid gap-2 border-b border-[#292d2d] py-5 sm:grid-cols-[180px_1fr]"><strong className="font-mono text-xs text-[#d8ff3e]">Session content</strong><p className="text-xs leading-6 text-[#8d9692]">Encrypted in transit. The broker holds frames only while it routes them and does not write chat content to storage.</p></div>
            <div className="grid gap-2 border-b border-[#292d2d] py-5 sm:grid-cols-[180px_1fr]"><strong className="font-mono text-xs text-[#d8ff3e]">Device secrets</strong><p className="text-xs leading-6 text-[#8d9692]">Relay private keys stay in the local config. Browser private keys stay in IndexedDB. One-time invite secrets expire or disappear after use.</p></div>
            <div className="grid gap-2 border-b border-[#292d2d] py-5 sm:grid-cols-[180px_1fr]"><strong className="font-mono text-xs text-[#d8ff3e]">Push notifications</strong><p className="text-xs leading-6 text-[#8d9692]">The broker and Push provider receive encrypted notification envelopes. Your service worker verifies and decrypts them on the device.</p></div>
            <div className="grid gap-2 border-b border-[#292d2d] py-5 sm:grid-cols-[180px_1fr]"><strong className="font-mono text-xs text-[#d8ff3e]">Visible metadata</strong><p className="text-xs leading-6 text-[#8d9692]">The service can see IP addresses, request times, message sizes, opaque room and device IDs, delivery timing, and Push endpoints.</p></div>
            <div className="grid gap-2 border-b border-[#292d2d] py-5 sm:grid-cols-[180px_1fr]"><strong className="font-mono text-xs text-[#d8ff3e]">Tracking</strong><p className="text-xs leading-6 text-[#8d9692]">The PWA has no account, analytics, advertising tracker, or application cookie.</p></div>
          </div>
        </div>
      </section>

      <section className="border-b border-[#2b5551] bg-[#0b1514] py-16">
        <div className="mx-auto grid w-full max-w-6xl gap-10 px-5 sm:px-8 lg:grid-cols-2">
          <div><p className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase text-[#ffbd4a]"><ShieldAlert size={15} /> Security boundary</p><h2 className="mt-4 font-mono text-3xl font-bold">What encryption does not hide.</h2></div>
          <div className="space-y-4 text-sm leading-7 text-[#9eb8b4]"><p>A compromised browser or development machine can read content at that endpoint. Revoke a lost device from the local CLI.</p><p>The broker can delay, drop, or reorder traffic. Hosting and Push providers can observe network metadata, but they cannot forge a valid approval.</p><p>remotty opens an outbound WSS connection. It does not expose an inbound OpenCode port.</p></div>
        </div>
      </section>

      <footer className="bg-[#090a0b] py-10">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-5 sm:flex-row sm:items-center sm:justify-between sm:px-8"><PublicBrand /><div className="flex flex-wrap gap-5 font-mono text-[10px] uppercase text-[#8d9692]"><a className="hover:text-[#42e8d4]" href="/pair">Pair</a><a className="hover:text-[#42e8d4]" href="https://github.com/d3vv3/remotty" target="_blank" rel="noreferrer">Source</a><a className="hover:text-[#42e8d4]" href="https://github.com/d3vv3/remotty/blob/main/LICENSE" target="_blank" rel="noreferrer">AGPL-3.0</a></div></div>
      </footer>
    </main>
  )
}

function LandingPage() {
  useEffect(() => {
    let anchor = ""
    try {
      anchor = decodeURIComponent(location.hash.slice(1))
    } catch {
      return
    }
    if (anchor !== "features") return
    requestAnimationFrame(() => document.getElementById(anchor)?.scrollIntoView())
  }, [])

  return (
    <main className="h-dvh overflow-y-auto bg-[#090a0b] text-[#f4f2eb] selection:bg-[#d8ff3e] selection:text-[#090a0b]">
      <header className="sticky top-0 z-30 border-b border-[#292d2d] bg-[#090a0bf2]">
        <nav className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-5 sm:px-8">
          <PublicBrand />
          <div className="flex items-center gap-2 sm:gap-4">
            <a className="hidden h-10 items-center gap-2 px-2 font-mono text-[10px] font-bold uppercase text-[#b5bdb9] hover:text-[#42e8d4] sm:inline-flex" href="/install/">Install</a>
            <a className="inline-flex h-10 items-center gap-2 px-2 font-mono text-[10px] font-bold uppercase text-[#b5bdb9] hover:text-[#42e8d4]" href="/privacy"><LockKeyhole size={15} /> Privacy</a>
            <a className="hidden size-10 place-items-center rounded-sm border border-[#3a4140] text-[#8d9692] hover:border-[#42e8d4] hover:text-[#42e8d4] sm:grid" href="https://github.com/d3vv3/remotty" target="_blank" rel="noreferrer" title="View remotty on GitHub"><Github size={18} /></a>
            <a className="inline-flex h-10 items-center gap-2 rounded-sm border border-[#efff91] bg-[#d8ff3e] px-4 font-mono text-xs font-bold uppercase text-[#080909] shadow-[3px_3px_0_#42e8d4] hover:translate-x-px hover:translate-y-px hover:shadow-[2px_2px_0_#42e8d4]" href="/pair">Pair <ArrowRight size={15} /></a>
          </div>
        </nav>
      </header>

      <section className="overflow-hidden border-b border-[#292d2d] bg-[#0c0e0f]">
        <div className="relative mx-auto min-h-[calc(100svh-96px)] w-full max-w-7xl px-5 py-16 sm:px-8 sm:py-20 lg:flex lg:min-h-[760px] lg:items-center lg:pr-[410px]">
          <div className="relative z-10 max-w-3xl text-center lg:text-left">
            <p className="mb-5 font-mono text-[10px] font-bold uppercase text-[#42e8d4]">OpenCode, away from your desk</p>
            <h1 className="m-0 font-mono text-6xl font-bold leading-none text-[#d8ff3e] [text-shadow:4px_4px_0_#42e8d4] sm:text-8xl xl:text-9xl">remotty</h1>
            <h2 className="mt-6 font-mono text-2xl font-bold leading-tight sm:text-4xl">Keep your coding agents moving from anywhere.</h2>
            <p className="mt-5 max-w-2xl text-sm leading-7 text-[#b5bdb9] sm:text-base">Watch OpenCode work, answer questions, approve commands, inspect diffs, and send the next instruction from an installable mobile PWA.</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3 lg:justify-start">
            <a className="inline-flex h-12 items-center gap-2 rounded-sm border border-[#efff91] bg-[#d8ff3e] px-6 font-mono text-xs font-bold uppercase text-[#080909] shadow-[4px_4px_0_#42e8d4]" href="/pair">Pair a device <ArrowRight size={16} /></a>
            <a className="inline-flex h-12 items-center gap-2 rounded-sm border border-[#3a4140] bg-[#141718] px-6 font-mono text-xs font-bold uppercase text-[#f4f2eb] hover:border-[#42e8d4] hover:text-[#42e8d4]" href="/install/"><Terminal size={16} /> Install</a>
            </div>
          </div>
          <div className="mt-12 flex justify-center lg:absolute lg:bottom-7 lg:right-16 lg:mt-0 xl:right-24"><PhonePreview /></div>
        </div>
      </section>

      <section className="border-b border-[#292d2d] bg-[#111415] py-20" id="features">
        <div className="mx-auto w-full max-w-7xl px-5 sm:px-8">
          <p className="font-mono text-[10px] font-bold uppercase text-[#ff635d]">Full remote control surface</p>
          <h2 className="mt-3 max-w-3xl font-mono text-3xl font-bold sm:text-5xl">Everything you need to leave the desk.</h2>
          <div className="mt-10 grid gap-px overflow-hidden rounded-md border border-[#292d2d] bg-[#292d2d] sm:grid-cols-2 lg:grid-cols-3">
            {publicFeatures.map(({ icon: Icon, title, copy }) => (
              <article className="min-h-48 bg-[#0e1011] p-6" key={title}>
                <span className="grid size-10 place-items-center rounded-sm border border-[#3a4140] bg-[#171a1b] text-[#d8ff3e]"><Icon size={19} /></span>
                <h3 className="mt-7 font-mono text-sm font-bold">{title}</h3>
                <p className="mt-3 text-xs leading-6 text-[#8d9692]">{copy}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-[#292d2d] bg-[#090a0b] py-20">
        <div className="mx-auto w-full max-w-7xl px-5 sm:px-8">
          <p className="font-mono text-[10px] font-bold uppercase text-[#42e8d4]">Three local steps</p>
          <h2 className="mt-3 font-mono text-3xl font-bold sm:text-5xl">Pair without an account.</h2>
          <div className="mt-10 grid border-y border-[#3a4140] md:grid-cols-3">
            <div className="border-b border-[#292d2d] py-7 md:border-b-0 md:border-r md:pr-8"><b className="font-mono text-xs text-[#ff635d]">01</b><h3 className="mt-4 font-mono text-sm font-bold">Install the plugin</h3><code className="mt-4 block overflow-x-auto border-l-2 border-[#42e8d4] bg-[#071817] p-3 font-mono text-[10px] text-[#42e8d4]">opencode plugin opencode-remotty --global --force</code></div>
            <div className="border-b border-[#292d2d] py-7 md:border-b-0 md:border-r md:px-8"><b className="font-mono text-xs text-[#ff635d]">02</b><h3 className="mt-4 font-mono text-sm font-bold">Create an invite</h3><code className="mt-4 block overflow-x-auto border-l-2 border-[#42e8d4] bg-[#071817] p-3 font-mono text-[10px] text-[#42e8d4]">npx --yes --package opencode-remotty@latest remotty pair</code></div>
            <div className="py-7 md:pl-8"><b className="font-mono text-xs text-[#ff635d]">03</b><h3 className="mt-4 font-mono text-sm font-bold">Scan and continue</h3><p className="mt-4 text-xs leading-6 text-[#8d9692]">Scan the QR code or paste the encrypted invite into the pairing page. Quit OpenCode, then run <code>opencode --continue</code>.</p></div>
          </div>
        </div>
      </section>

      <footer className="bg-[#090a0b] py-10">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-5 sm:flex-row sm:items-center sm:justify-between sm:px-8"><PublicBrand /><div className="flex flex-wrap gap-5 font-mono text-[10px] uppercase text-[#8d9692]"><a className="hover:text-[#42e8d4]" href="/install/">Install</a><a className="hover:text-[#42e8d4]" href="/pair">Pair</a><a className="hover:text-[#42e8d4]" href="/privacy">Privacy</a><a className="hover:text-[#42e8d4]" href="https://github.com/d3vv3/remotty" target="_blank" rel="noreferrer">Source</a><a className="hover:text-[#42e8d4]" href="https://github.com/d3vv3/remotty/blob/main/LICENSE" target="_blank" rel="noreferrer">AGPL-3.0</a></div></div>
      </footer>
    </main>
  )
}

function PairingScreen({ onConnect, error }: { onConnect: (bundle: PairingBundle) => void; error?: string }) {
  const [code, setCode] = useState("")
  const [scannerOpen, setScannerOpen] = useState(false)
  const [pairingError, setPairingError] = useState<string>()
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const bundle = pairingBundleFrom(code)
    if (!bundle) {
      setPairingError("Enter a valid remotty v2 encrypted invite.")
      return
    }
    onConnect(bundle)
  }
  return (
    <main className="h-dvh overflow-y-auto bg-[#090a0b] text-[#f4f2eb]">
      <header className="border-b-2 border-[#d8ff3e] bg-[#0b0d0e]">
        <nav className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5 sm:px-8"><PublicBrand /><div className="flex items-center gap-5"><a className="font-mono text-[10px] uppercase text-[#8d9692] hover:text-[#42e8d4]" href="/install/">Install</a><a className="font-mono text-[10px] uppercase text-[#8d9692] hover:text-[#42e8d4]" href="/privacy">Privacy</a><a className="inline-flex items-center gap-2 font-mono text-[10px] uppercase text-[#8d9692] hover:text-[#42e8d4]" href="https://github.com/d3vv3/remotty" target="_blank" rel="noreferrer"><Github size={15} /> GitHub</a></div></nav>
      </header>
      <section className="mx-auto grid min-h-[calc(100svh-64px)] w-full max-w-6xl items-center gap-12 px-5 py-12 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(400px,.85fr)]">
        <div>
          <p className="font-mono text-[10px] font-bold uppercase text-[#42e8d4]">Connect this browser</p>
          <h1 className="mt-4 font-mono text-4xl font-bold sm:text-6xl">Pair your device.</h1>
          <p className="mt-5 max-w-xl text-sm leading-7 text-[#b5bdb9]">Paste the invite token printed by the local CLI, or scan its QR code.</p>
          <form onSubmit={submit} className="mt-8 max-w-xl">
            <label className="mb-2 flex items-center gap-2 font-mono text-[9px] font-bold uppercase text-[#d8ff3e]" htmlFor="pairing-code"><KeyRound size={14} /> Encrypted invite</label>
            <div className="grid grid-cols-[minmax(0,1fr)_48px_48px] gap-2">
              <input className="h-12 min-w-0 rounded-sm border border-[#3a4140] bg-[#151819] px-4 font-mono text-xs text-[#f4f2eb] outline-none focus:border-[#d8ff3e] focus:ring-2 focus:ring-[#d8ff3e26]" id="pairing-code" value={code} onChange={(event) => { setCode(event.target.value); setPairingError(undefined) }} placeholder="Paste v2 encrypted invite" autoCapitalize="none" autoComplete="one-time-code" maxLength={4096} autoFocus />
              <button type="button" className="grid size-12 place-items-center rounded-sm border border-[#42e8d4] bg-[#071817] text-[#42e8d4] hover:bg-[#42e8d4] hover:text-[#071817]" title="Scan pairing QR code" aria-label="Scan pairing QR code" onClick={() => setScannerOpen(true)}><ScanLine size={20} /></button>
              <button type="submit" className="grid size-12 place-items-center rounded-sm border border-[#efff91] bg-[#d8ff3e] text-[#080909] shadow-[3px_3px_0_#42e8d4]" aria-label="Connect remotty"><ChevronRight size={20} /></button>
            </div>
            {(pairingError ?? error) && <p className="mt-3 font-mono text-[10px] text-[#ff635d]">{pairingError ?? error}</p>}
          </form>
        </div>
        <div className="border-y border-[#3a4140] bg-[#0c0f10]">
          <div className="flex h-12 items-center gap-2 border-b border-[#292d2d] px-4 font-mono text-[10px] font-bold uppercase text-[#d8ff3e]"><Terminal size={18} /> Install and pair</div>
          <div className="grid min-h-28 grid-cols-[44px_1fr] gap-3 border-b border-[#292d2d] p-4"><b className="font-mono text-[10px] text-[#ff635d]">01</b><div><strong className="text-xs">Add the OpenCode plugin</strong><code className="mt-3 block overflow-x-auto border-l-2 border-[#42e8d4] bg-[#071817] p-3 font-mono text-[9px] text-[#42e8d4]">opencode plugin opencode-remotty --global --force</code></div></div>
          <div className="grid min-h-28 grid-cols-[44px_1fr] gap-3 border-b border-[#292d2d] p-4"><b className="font-mono text-[10px] text-[#ff635d]">02</b><div><strong className="text-xs">Create an encrypted device invite</strong><code className="mt-3 block overflow-x-auto border-l-2 border-[#42e8d4] bg-[#071817] p-3 font-mono text-[9px] text-[#42e8d4]">npx --yes --package opencode-remotty@latest remotty pair</code></div></div>
          <div className="grid min-h-28 grid-cols-[44px_1fr] gap-3 p-4"><b className="font-mono text-[10px] text-[#ff635d]">03</b><div><strong className="text-xs">Restart OpenCode</strong><p className="mt-2 text-xs text-[#8d9692]">Quit the running OpenCode process, then run:</p><code className="mt-3 block overflow-x-auto border-l-2 border-[#42e8d4] bg-[#071817] p-3 font-mono text-[9px] text-[#42e8d4]">opencode --continue</code></div></div>
        </div>
      </section>
      {scannerOpen && <PairingScanner onClose={() => setScannerOpen(false)} onScan={(bundle) => { setScannerOpen(false); onConnect(bundle) }} />}
    </main>
  )
}

type BarcodeDetectorLike = new (options?: { formats?: string[] }) => {
  detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>>
}

function PairingScanner({ onScan, onClose }: { onScan: (bundle: PairingBundle) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string>()

  useEffect(() => {
    let cancelled = false
    const cleanups: Array<() => void> = []
    const stopAll = () => {
      for (const cleanup of cleanups.splice(0)) cleanup()
    }
    const finish = (text: string) => {
      if (cancelled) return
      const bundle = pairingBundleFrom(text)
      if (!bundle) {
        setError("This QR code does not contain a remotty v2 encrypted invite.")
        return
      }
      cancelled = true
      stopAll()
      onScan(bundle)
    }

    const scanWithZxing = async (stream: MediaStream, video: HTMLVideoElement) => {
      const [{ BrowserQRCodeReader }, { DecodeHintType }] = await Promise.all([
        import("@zxing/browser"),
        import("@zxing/library"),
      ])
      if (cancelled) return
      const hints = new Map([[DecodeHintType.TRY_HARDER, true]])
      const reader = new BrowserQRCodeReader(hints, { delayBetweenScanAttempts: 50 })
      const controls = await reader.decodeFromStream(stream, video, (result) => {
        if (result) finish(result.getText())
      })
      if (cancelled) controls.stop()
      else cleanups.push(() => controls.stop())
    }

    const scanWithDetector = (video: HTMLVideoElement, Detector: BarcodeDetectorLike, onBroken: () => void) => {
      const detector = new Detector({ formats: ["qr_code"] })
      let fellBack = false
      const timer = window.setInterval(() => {
        if (video.readyState < 2) return
        detector.detect(video).then((codes) => {
          const value = codes.find((code) => code.rawValue)?.rawValue
          if (value) finish(value)
        }).catch(() => {
          if (fellBack) return
          fellBack = true
          window.clearInterval(timer)
          onBroken()
        })
      }, 100)
      cleanups.push(() => window.clearInterval(timer))
    }

    const start = async () => {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
      })
      cleanups.push(() => {
        for (const track of stream.getTracks()) track.stop()
      })
      if (cancelled) {
        stopAll()
        return
      }
      const [track] = stream.getVideoTracks()
      await track?.applyConstraints({ advanced: [{ focusMode: "continuous" }] } as unknown as MediaTrackConstraints).catch(() => undefined)
      const video = videoRef.current
      if (!video) return
      video.srcObject = stream
      await video.play().catch(() => undefined)
      if (cancelled) return
      const Detector = (window as { BarcodeDetector?: BarcodeDetectorLike }).BarcodeDetector
      if (Detector) {
        try {
          scanWithDetector(video, Detector, () => {
            void scanWithZxing(stream, video).catch(() => setError("The QR scanner failed to start."))
          })
          return
        } catch {
          // fall through to zxing
        }
      }
      await scanWithZxing(stream, video)
    }

    void start().catch(() => setError("Camera access is unavailable. Check the browser permission."))

    return () => {
      cancelled = true
      stopAll()
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

function SessionRow({ session, needsInput, offline, selected, onSelect }: { session: SessionSummary; needsInput: boolean; offline: boolean; selected: boolean; onSelect: () => void }) {
  const state = offline ? "error" : needsInput ? "needs-input" : session.status
  const stateLabel = offline ? "Workspace offline" : needsInput ? "Needs attention" : session.status === "idle" ? "Ready or finished" : session.status === "error" ? "Error" : "Working or retrying"
  return (
    <button className={`session-row ${selected ? "selected" : ""}`} onClick={onSelect}>
      <span className={`status-dot ${state}`} title={stateLabel} aria-label={stateLabel} />
      <span className="session-copy">
        <strong>{session.title}</strong>
        <span><GitBranch size={13} /><i>{session.branch ?? "no branch"}</i></span>
      </span>
      <span className="session-meta">
        <time>{relativeTime(session.updatedAt)}</time>
        <span className="diff-count"><b>+{session.additions}</b> <i>-{session.deletions}</i></span>
      </span>
      <ChevronRight size={17} />
    </button>
  )
}

function ConnectionDetails({ relayState, onClose }: { relayState: ReturnType<typeof useRelay>; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  useEffect(() => {
    closeRef.current?.focus()
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose()
      if (event.key !== "Tab") return
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])") ?? [])]
      if (!focusable.length) return
      const first = focusable[0]!
      const last = focusable.at(-1)!
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    window.addEventListener("keydown", escape)
    return () => window.removeEventListener("keydown", escape)
  }, [onClose])
  const refresh = () => { void relayState.request({ type: "snapshot.request" }).catch((error) => relayState.setError(error.message)) }
  return (
    <div className="connection-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section ref={dialogRef} className="connection-dialog" id="connection-status-dialog" role="dialog" aria-modal="true" aria-labelledby="connection-title">
        <header><h2 id="connection-title">Connection status</h2><button ref={closeRef} className="icon-button" title="Close" aria-label="Close connection status" onClick={onClose}><X size={18} /></button></header>
        <div className="connection-dialog-body"><div className="connection-row"><span>Remotty service</span><b>{relayState.serviceConnected ? "Connected" : "Unreachable"}</b></div>
        {relayState.relays.map((relay) => {
          const health = relayState.relayHealth[relay.id]
          return <div className="connection-row" key={relay.id}><span>Your computer<small>{relay.name} . {relay.workspace}</small></span><b>{relayState.isRelayConnected(relay.id) ? "Connected" : "Offline"}<small>{health?.rtt ? `${health.rtt} ms` : health?.lastContact ? `Last contact ${relativeTime(health.lastContact)}` : ""}</small></b></div>
        })}
        <div className="connection-row"><span>OpenCode data</span><b>{relayState.lastSyncedAt && Date.now() - relayState.lastSyncedAt < 60_000 ? "Current" : "Stale"}<small>{relayState.lastSyncedAt ? `Updated ${relativeTime(relayState.lastSyncedAt)}` : "Not yet synced"}</small></b></div></div>
        <footer><button className="notification-secondary" onClick={onClose}>Close</button><button className="notification-primary" onClick={refresh}><RefreshCw size={15} /> Refresh</button></footer>
      </section>
    </div>
  )
}

function NewSessionDialog({
  relays,
  isConnected,
  onCreate,
  onClose,
}: {
  relays: RelayInfo[]
  isConnected: (relayId: string) => boolean
  onCreate: (relayId: string) => Promise<void>
  onClose: () => void
}) {
  const available = useMemo(
    () => relays.filter((relay) => isConnected(relay.id) && relaySupportsSessionCreate(relay)),
    [isConnected, relays],
  )
  const [relayId, setRelayId] = useState(() => available[0]?.id ?? "")
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string>()
  const closeRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!available.some((relay) => relay.id === relayId)) setRelayId(available[0]?.id ?? "")
  }, [available, relayId])
  useEffect(() => {
    closeRef.current?.focus()
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !creating) onClose()
      if (event.key !== "Tab") return
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>("button, select, [tabindex]:not([tabindex='-1'])") ?? [])]
        .filter((element) => !element.hasAttribute("disabled"))
      if (!focusable.length) return
      const first = focusable[0]!
      const last = focusable.at(-1)!
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [creating, onClose])

  const create = async () => {
    if (!relayId || creating) return
    setCreating(true)
    setError(undefined)
    try {
      await onCreate(relayId)
    } catch (cause) {
      const message = (cause as Error).message
      setError(promptDeliveryState(message) === "uncertain"
        ? "Session creation outcome is uncertain. Refresh sessions before trying again."
        : message)
      setCreating(false)
    }
  }

  return (
    <div className="connection-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !creating) onClose() }}>
      <section ref={dialogRef} className="connection-dialog new-session-dialog" role="dialog" aria-modal="true" aria-labelledby="new-session-title">
        <header><h2 id="new-session-title">New session</h2><button ref={closeRef} className="icon-button" title="Close" aria-label="Close new session" onClick={onClose} disabled={creating}><X size={18} /></button></header>
        <div className="new-session-body">
          <label htmlFor="new-session-workspace">Workspace</label>
          <select id="new-session-workspace" value={relayId} onChange={(event) => setRelayId(event.target.value)} disabled={creating}>
            {relays.map((relay) => {
              const connected = isConnected(relay.id)
              const supported = relaySupportsSessionCreate(relay)
              const suffix = !connected ? " (offline)" : !supported ? " (update plugin)" : ""
              return <option key={relay.id} value={relay.id} disabled={!connected || !supported}>{relay.name} - {folderName(relay.workspace)}{suffix}</option>
            })}
          </select>
          {relayId && <small>{relays.find((relay) => relay.id === relayId)?.workspace}</small>}
          {!available.length && <p className="form-error" role="status">No connected workspace supports session creation. Reconnect after updating the OpenCode plugin.</p>}
          {error && <p className="form-error" role="alert">{error}</p>}
        </div>
        <footer><button className="notification-secondary" onClick={onClose} disabled={creating}>Cancel</button><button className="notification-primary" onClick={() => void create()} disabled={!relayId || creating}>{creating ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />} Create</button></footer>
      </section>
    </div>
  )
}

function SessionDetail({
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
  agents: AgentSummary[]
  revision: number
  resourceRevisions: SessionResourceRevisions
  subagents: RoutedSubagent[]
  subagentRevisions: Record<string, number>
  supportsSubagents?: boolean
  permission?: PermissionRequest
  question?: QuestionRequest
  request: (command: any, progress?: (messages: SessionMessage[]) => void) => Promise<unknown>
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
  const persistenceRef = useRef<Promise<void>>(Promise.resolve())
  const selectedAgent = agents.find((item) => item.name === agent)
  const selectedAgentStyle = { "--agent-color": selectedAgent?.color ?? "var(--cyan)" } as CSSProperties
  const visibleSubagentEntries = useMemo(() => visibleSubagents(subagents), [subagents])
  const showComposer = tab !== "subagents"
  const persistMessageCache = useCallback((cache: MessageCache<SessionMessage>) => {
    messageCacheRef.current = cache
    setMessages(visibleCachedMessages(cache))
    retainedSessionState.write(sessionKey, { messageCache: cache, messages: visibleCachedMessages(cache) })
    // Serialize IndexedDB writes so an older progress save cannot win a newer commit.
    persistenceRef.current = persistenceRef.current.catch(() => undefined).then(() => saveCache("messages", cache))
    return persistenceRef.current
  }, [saveCache, sessionKey])
  const persistLocalMessages = useCallback((messages: SessionMessage[]) =>
    persistMessageCache({ ...messageCacheRef.current, local: { ...messageCacheRef.current.local, messages: messages.filter((message) => message.info.delivery !== undefined) } }), [persistMessageCache])

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
        const progress = key === "messages" ? async (partial: SessionMessage[]) => {
          if (!owns()) return
          let cache = messageCacheRef.current
          for (const message of partial) {
            if (!owns()) return
            cache = await stageMessage(cache, message)
            if (!owns()) return
          }
          if (owns()) await persistMessageCache(cache)
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
                const committed = await replaceCanonicalMessages(messageCacheRef.current, next as SessionMessage[])
                if (!owns()) return false
                await persistMessageCache(committed)
              }
            }
            else update(next)
            if (key !== "messages") void saveCache(key, next)
          }
        }
        return owns()
      } catch {
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
      }).catch(() => {
        if (generation !== generationRef.current) return
        const cache = emptyMessageCache<SessionMessage>()
        messageCacheRef.current = cache
        setMessages([])
        setMessageCacheReadySession(session.id)
      }),
      loadCache<SessionTodo[]>("todos").then((cached) => cached && generation === generationRef.current && setTodos((current) => current.length ? current : cached.value)),
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
  const processedUserMessages = useMemo(
    () => new Set(messages.flatMap((message) => message.info.role === "assistant" && message.info.parentID ? [message.info.parentID] : [])),
    [messages],
  )
  const isThinking = useMemo(
    () => messages.some((message) => message.parts.some((part) => part.type === "reasoning" && part.time?.start && !part.time.end)),
    [messages],
  )

  useLayoutEffect(() => {
    if (tab !== "activity" || !followOutputRef.current || document.activeElement === promptRef.current) return
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
      void persistLocalMessages(next)
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
        void persistLocalMessages(next)
        return next
      })
      setPrompt((current) => clearSubmittedDraft(current, rawSubmitted))
    } catch (error) {
      const delivery = promptDeliveryState((error as Error).message)
      setMessages((current) => {
        const next = current.map((message) => message.info.id === messageId ? { ...message, info: { ...message.info, delivery, ...(delivery === "uncertain" ? { legacyPrompt: true } : {}) } } : message)
        void persistLocalMessages(next)
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
                {agents.map((item) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={item.name === agent}
                    className={item.name === agent ? "selected" : ""}
                    style={{ "--agent-color": item.color ?? "var(--cyan)" } as CSSProperties}
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
        <button type="button" role="tab" aria-selected={tab === "activity"} className={tab === "activity" ? "active" : ""} onClick={() => selectTab("activity")}>Activity</button>
        <button type="button" role="tab" aria-selected={tab === "todos"} className={tab === "todos" ? "active" : ""} onClick={() => selectTab("todos")}>Todos <span>{todos.filter((todo) => todo.status !== "completed" && todo.status !== "cancelled").length}</span></button>
        <button type="button" role="tab" aria-selected={tab === "changes"} className={tab === "changes" ? "active" : ""} onClick={() => selectTab("changes")}>Changes <span>{diffs.length}</span></button>
        {(supportsSubagents || visibleSubagentEntries.length > 0) && <button type="button" role="tab" aria-selected={tab === "subagents"} className={tab === "subagents" ? "active" : ""} onClick={() => selectTab("subagents")}>Subagents <span>{visibleSubagentEntries.length}</span></button>}
      </div>

      <div
        className="detail-content"
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
                {visibleMessages.map((message) => <Message key={message.info.id} message={message} queued={message.info.delivery ?? (message.info.role === "user" && !processedUserMessages.has(message.info.id) ? "queued" : undefined)} />)}
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

      {(permission || question || showComposer) && <div className="input-dock">
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
          <button className="primary-button" type="submit" disabled={!prompt.trim() || sending || messageCacheReadySession !== session.id} aria-label="Send prompt">
            {sending ? <LoaderCircle className="spin" size={19} /> : <Send size={19} />}
          </button>
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

function QuestionPanel({ requestInfo, request, onError }: { requestInfo: QuestionRequest; request: (command: any) => Promise<unknown>; onError: (error?: string) => void }) {
  const [answers, setAnswers] = useState<string[][]>(() => requestInfo.questions.map(() => []))
  const [expanded, setExpanded] = useState(true)

  useEffect(() => setExpanded(true), [requestInfo.id])

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
    void request({ type: "question.reply", sessionId: requestInfo.targetSessionID ?? requestInfo.sessionID, questionId: requestInfo.id, answers }).catch((error) => onError(error.message))
  }

  return (
    <section className={`question-panel ${expanded ? "" : "collapsed"}`}>
      <button className="question-title" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}><CircleHelp size={20} /><strong>OpenCode needs input</strong><ChevronDown size={18} /></button>
      {expanded && <>
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
          <button onClick={() => void request({ type: "question.reject", sessionId: requestInfo.targetSessionID ?? requestInfo.sessionID, questionId: requestInfo.id }).catch((error) => onError(error.message))}>Dismiss</button>
          <button className="confirm" onClick={submit}>Continue <ChevronRight size={16} /></button>
        </div>
      </>}
    </section>
  )
}

function PermissionPanel({ permission, request, onError }: { permission: PermissionRequest; request: (command: any) => Promise<unknown>; onError: (error?: string) => void }) {
  const reply = (response: "once" | "always" | "reject") =>
    request({
      type: "permission.reply",
      sessionId: permission.targetSessionID ?? permission.sessionID,
      permissionId: permission.id,
      response,
      ...(permission.replyDialect ? { replyDialect: permission.replyDialect } : {}),
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

function Message({ message, queued }: { message: SessionMessage; queued?: SessionMessage["info"]["delivery"] }) {
  const isUser = message.info.role === "user"
  return (
    <article className={`message ${message.info.role}`} aria-label={isUser ? "Your message" : "OpenCode response"}>
      <div className="message-frame">
        <span className="message-sigil" aria-hidden="true">
          {isUser ? <UserRound size={15} /> : <Code2 size={16} />}
        </span>
        <div className="message-body">
          {queued && <span className="queued-flag"><Clock3 size={12} /> {queued === "accepted" ? "Accepted by OpenCode" : queued === "uncertain" ? "Delivery uncertain" : queued}</span>}
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

const folderName = (directory: string) => directory.split(/[\\/]/).filter(Boolean).at(-1) ?? directory
