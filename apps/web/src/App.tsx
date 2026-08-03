import { FormEvent, KeyboardEvent, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react"
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
import type { IScannerControls } from "@zxing/browser"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import type { AgentSummary, PairingBundle, PermissionRequest, QuestionRequest, SessionSummary } from "@remotty/protocol"
import { useRelay } from "./useRelay"
import { pairingBundleFrom } from "./pairing"
import { NOTIFICATION_PROMPT_SEEN, shouldOfferPushNotifications } from "./notificationPrompt"
import type { RoutedSession } from "./relayState"

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
type SessionMessage = { info: { id: string; role: string; parentID?: string; time?: { created?: number } }; parts: MessagePart[] }
type FileDiff = { file: string; additions: number; deletions: number }
type SessionTodo = { id: string; content: string; status: string; priority: string }

let routePairingBundle = location.pathname === "/pair" && location.hash
  ? pairingBundleFrom(location.href)
  : undefined
if (routePairingBundle) history.replaceState({}, "", "/app")

export function App() {
  const [pairingBundle] = useState(routePairingBundle)
  useEffect(() => {
    routePairingBundle = undefined
  }, [])
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !navigator.serviceWorker.controller) return
    const reload = () => location.reload()
    navigator.serviceWorker.addEventListener("controllerchange", reload, { once: true })
    return () => navigator.serviceWorker.removeEventListener("controllerchange", reload)
  }, [])
  if (location.pathname === "/") return <LandingPage />
  if (location.pathname === "/privacy") return <PrivacyPage />
  return <RelayApp initialBundle={pairingBundle} />
}

function RelayApp({ initialBundle }: { initialBundle?: PairingBundle }) {
  const relayState = useRelay(initialBundle)
  const [selectedKey, setSelectedKey] = useState<string | undefined>(
    () => new URLSearchParams(location.search).get("session") ?? undefined,
  )
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set())
  const [notificationPromptOpen, setNotificationPromptOpen] = useState(false)
  const [enablingNotifications, setEnablingNotifications] = useState(false)
  const sessionKey = (session: SessionSummary & { workspaceRelayId?: string }) => `${session.workspaceRelayId ?? ""}:${session.id}`
  const selected = relayState.sessions.find((session) =>
    sessionKey(session) === selectedKey || (!selectedKey?.includes(":") && session.id === selectedKey),
  )
  const sessionGroups = useMemo(() => {
    const groups = new Map<string, RoutedSession[]>()
    for (const session of relayState.sessions) {
      groups.set(session.directory, [...(groups.get(session.directory) ?? []), session])
    }
    return [...groups.entries()].sort(
      ([, left], [, right]) => Math.max(...right.map((session) => session.updatedAt)) - Math.max(...left.map((session) => session.updatedAt)),
    )
  }, [relayState.sessions])

  useEffect(() => {
    if (!relayState.error) return
    const timeout = window.setTimeout(() => relayState.setError(undefined), 6_000)
    return () => window.clearTimeout(timeout)
  }, [relayState.error])

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

  const toggleGroup = (directory: string) => setCollapsedGroups((current) => {
    const next = new Set(current)
    if (next.has(directory)) next.delete(directory)
    else next.add(directory)
    return next
  })

  if (relayState.connection === "disconnected" && !relayState.relay) {
    return (
      <PairingScreen
        onConnect={(bundle) => {
          localStorage.removeItem(NOTIFICATION_PROMPT_SEEN)
          history.replaceState({}, "", "/app")
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
          {relayState.connection === "online" ? <Wifi size={15} /> : <WifiOff size={15} />}
          {relayState.connection === "online" ? "Live" : "Relay offline"}
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
            <button
              className="icon-button"
              title="Refresh sessions"
              onClick={() => void relayState.request({ type: "snapshot.request" })}
              disabled={relayState.connection !== "online"}
            >
              <RefreshCw size={17} />
            </button>
          </div>
          <div className="session-legend" aria-label="Session status colors">
            <span><i className="status-dot idle" />Ready/finished</span>
            <span><i className="status-dot busy" />Working/retrying</span>
            <span><i className="status-dot needs-input" />Needs attention</span>
            <span><i className="status-dot error" />Offline/error</span>
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
                    needsInput={relayState.permissions.some((item) => item.sessionID === session.id && item.workspaceRelayId === session.workspaceRelayId) || relayState.questions.some((item) => item.sessionID === session.id && item.workspaceRelayId === session.workspaceRelayId)}
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
              agents={relayState.agents.filter((agent) => agent.workspaceRelayId === selected.workspaceRelayId)}
              revision={relayState.sessionRevisions[sessionKey(selected)] ?? 0}
              permission={relayState.permissions.find((permission) => permission.sessionID === selected.id && permission.workspaceRelayId === selected.workspaceRelayId)}
              question={relayState.questions.find((question) => question.sessionID === selected.id && question.workspaceRelayId === selected.workspaceRelayId)}
              request={(command) => relayState.request(command, selected.workspaceRelayId)}
              onBack={() => setSelectedKey(undefined)}
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
        <div className="toast" role="alert"><AlertTriangle size={17} /><span>{relayState.error}</span><button title="Dismiss error" onClick={() => relayState.setError(undefined)}><X size={16} /></button></div>
      )}
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
            <h1 className="m-0 font-mono text-6xl font-bold leading-none text-[#d8ff3e] sm:text-8xl xl:text-9xl">remotty</h1>
            <h2 className="mt-6 font-mono text-2xl font-bold leading-tight sm:text-4xl">Keep your coding agents moving from anywhere.</h2>
            <p className="mt-5 max-w-2xl text-sm leading-7 text-[#b5bdb9] sm:text-base">Watch OpenCode work, answer questions, approve commands, inspect diffs, and send the next instruction from an installable mobile PWA.</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3 lg:justify-start">
            <a className="inline-flex h-12 items-center gap-2 rounded-sm border border-[#efff91] bg-[#d8ff3e] px-6 font-mono text-xs font-bold uppercase text-[#080909] shadow-[4px_4px_0_#42e8d4]" href="/pair">Pair a device <ArrowRight size={16} /></a>
            <a className="inline-flex h-12 items-center gap-2 rounded-sm border border-[#3a4140] bg-[#141718] px-6 font-mono text-xs font-bold uppercase text-[#f4f2eb] hover:border-[#42e8d4] hover:text-[#42e8d4]" href="https://github.com/d3vv3/remotty" target="_blank" rel="noreferrer"><Github size={16} /> GitHub</a>
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
            <div className="border-b border-[#292d2d] py-7 md:border-b-0 md:border-r md:pr-8"><b className="font-mono text-xs text-[#ff635d]">01</b><h3 className="mt-4 font-mono text-sm font-bold">Install the plugin</h3><code className="mt-4 block overflow-x-auto border-l-2 border-[#42e8d4] bg-[#071817] p-3 font-mono text-[10px] text-[#42e8d4]">"opencode-remotty@0.2.6"</code></div>
            <div className="border-b border-[#292d2d] py-7 md:border-b-0 md:border-r md:px-8"><b className="font-mono text-xs text-[#ff635d]">02</b><h3 className="mt-4 font-mono text-sm font-bold">Create an invite</h3><code className="mt-4 block overflow-x-auto border-l-2 border-[#42e8d4] bg-[#071817] p-3 font-mono text-[10px] text-[#42e8d4]">npx opencode-remotty pair</code></div>
            <div className="py-7 md:pl-8"><b className="font-mono text-xs text-[#ff635d]">03</b><h3 className="mt-4 font-mono text-sm font-bold">Scan and continue</h3><p className="mt-4 text-xs leading-6 text-[#8d9692]">Restart OpenCode. Scan the QR code or paste the encrypted invite into the pairing page.</p></div>
          </div>
        </div>
      </section>

      <footer className="bg-[#090a0b] py-10">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-5 sm:flex-row sm:items-center sm:justify-between sm:px-8"><PublicBrand /><div className="flex flex-wrap gap-5 font-mono text-[10px] uppercase text-[#8d9692]"><a className="hover:text-[#42e8d4]" href="/pair">Pair</a><a className="hover:text-[#42e8d4]" href="/privacy">Privacy</a><a className="hover:text-[#42e8d4]" href="https://github.com/d3vv3/remotty" target="_blank" rel="noreferrer">Source</a><a className="hover:text-[#42e8d4]" href="https://github.com/d3vv3/remotty/blob/main/LICENSE" target="_blank" rel="noreferrer">AGPL-3.0</a></div></div>
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
        <nav className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5 sm:px-8"><PublicBrand /><div className="flex items-center gap-5"><a className="font-mono text-[10px] uppercase text-[#8d9692] hover:text-[#42e8d4]" href="/privacy">Privacy</a><a className="inline-flex items-center gap-2 font-mono text-[10px] uppercase text-[#8d9692] hover:text-[#42e8d4]" href="https://github.com/d3vv3/remotty" target="_blank" rel="noreferrer"><Github size={15} /> GitHub</a></div></nav>
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
          <div className="grid min-h-28 grid-cols-[44px_1fr] gap-3 border-b border-[#292d2d] p-4"><b className="font-mono text-[10px] text-[#ff635d]">01</b><div><strong className="text-xs">Add the OpenCode plugin</strong><code className="mt-3 block overflow-x-auto border-l-2 border-[#42e8d4] bg-[#071817] p-3 font-mono text-[9px] text-[#42e8d4]">{`"plugin": ["opencode-remotty@0.2.6"]`}</code></div></div>
          <div className="grid min-h-28 grid-cols-[44px_1fr] gap-3 border-b border-[#292d2d] p-4"><b className="font-mono text-[10px] text-[#ff635d]">02</b><div><strong className="text-xs">Create an encrypted device invite</strong><code className="mt-3 block overflow-x-auto border-l-2 border-[#42e8d4] bg-[#071817] p-3 font-mono text-[9px] text-[#42e8d4]">npx opencode-remotty pair</code></div></div>
          <div className="grid min-h-28 grid-cols-[44px_1fr] gap-3 p-4"><b className="font-mono text-[10px] text-[#ff635d]">03</b><div><strong className="text-xs">Restart OpenCode</strong><code className="mt-3 block overflow-x-auto border-l-2 border-[#42e8d4] bg-[#071817] p-3 font-mono text-[9px] text-[#42e8d4]">opencode --continue</code></div></div>
        </div>
      </section>
      {scannerOpen && <PairingScanner onClose={() => setScannerOpen(false)} onScan={(bundle) => { setScannerOpen(false); onConnect(bundle) }} />}
    </main>
  )
}

function PairingScanner({ onScan, onClose }: { onScan: (bundle: PairingBundle) => void; onClose: () => void }) {
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
        const bundle = pairingBundleFrom(result.getText())
        if (!bundle) {
          setError("This QR code does not contain a remotty v2 encrypted invite.")
          return
        }
        scannerControls.stop()
        onScan(bundle)
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
  const mountedRef = useRef(true)
  const followOutputRef = useRef(true)
  const lastScrollTopRef = useRef(0)
  const snapshotRef = useRef<Record<string, string>>({})
  const selectedAgent = agents.find((item) => item.name === agent)
  const selectedAgentStyle = { "--agent-color": selectedAgent?.color ?? "var(--cyan)" } as CSSProperties

  const refresh = async () => {
    const load = async <T,>(
      key: string,
      command: Record<string, unknown>,
      update: (value: T[]) => void,
    ) => {
      try {
        const result = await request(command)
        if (mountedRef.current) {
          const next = Array.isArray(result) ? result as T[] : []
          const snapshot = JSON.stringify(next)
          if (snapshotRef.current[key] !== snapshot) {
            snapshotRef.current[key] = snapshot
            update(next)
          }
        }
      } catch {
        return
      }
    }
    await Promise.all([
      load<SessionMessage>("messages", { type: "session.messages", sessionId: session.id }, setMessages),
      load<SessionTodo>("todos", { type: "session.todos", sessionId: session.id }, setTodos),
      load<FileDiff>("diffs", { type: "session.diff", sessionId: session.id }, setDiffs),
    ])
    if (!mountedRef.current) return
    setLoading(false)
  }

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

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
      if (detailContentRef.current) detailContentRef.current.scrollTop = detailContentRef.current.scrollHeight
    })
    return () => cancelAnimationFrame(frame)
  }, [tab, visibleMessages])

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
        <button type="button" role="tab" aria-selected={tab === "activity"} className={tab === "activity" ? "active" : ""} onClick={() => setTab("activity")}>Activity</button>
        <button type="button" role="tab" aria-selected={tab === "todos"} className={tab === "todos" ? "active" : ""} onClick={() => { setTab("todos"); void refresh() }}>Todos <span>{todos.filter((todo) => todo.status !== "completed" && todo.status !== "cancelled").length}</span></button>
        <button type="button" role="tab" aria-selected={tab === "changes"} className={tab === "changes" ? "active" : ""} onClick={() => { setTab("changes"); void refresh() }}>Changes <span>{diffs.length}</span></button>
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
                {visibleMessages.map((message) => <Message key={message.info.id} message={message} queued={message.info.role === "user" && !processedUserMessages.has(message.info.id)} />)}
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
        {(session.status === "busy" || session.status === "retry") && (
          <div className="work-strip" role="status">
            <span className="work-pulse"><i /><i /><i /></span>
            <strong>{isThinking ? "Thinking" : "Working"}</strong>
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

function Message({ message, queued }: { message: SessionMessage; queued?: boolean }) {
  const isUser = message.info.role === "user"
  return (
    <article className={`message ${message.info.role}`} aria-label={isUser ? "Your message" : "OpenCode response"}>
      <div className="message-frame">
        <span className="message-sigil" aria-hidden="true">
          {isUser ? <UserRound size={15} /> : <Code2 size={16} />}
        </span>
        <div className="message-body">
          {queued && <span className="queued-flag"><Clock3 size={12} /> Queued</span>}
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
