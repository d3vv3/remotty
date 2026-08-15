import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AlertTriangle, Bell, BellOff, ChevronDown, ChevronRight, Code2, Folder, Github, GitBranch, Laptop, LoaderCircle, LogOut, Plus, RefreshCw, Wifi, WifiOff, X } from "lucide-react"
import type { PairingBundle, RelayInfo, SessionSummary } from "@remotty/protocol"
import { Button, IconButton } from "../components/ui"
import { NOTIFICATION_PROMPT_SEEN, shouldOfferPushNotifications } from "../features/notifications"
import { PairingScreen, routeForEnrollment } from "../features/pairing"
import { pwaBuildFromModuleScriptUrls } from "../features/pwa"
import { effectiveConnectionPresentation, exactConnectionTime, relayConnectionPresentation, relaySupportsSessionCreate, serviceConnectionPresentation, stableWorkspaceKey, useRelay, workspaceSessionKey, type RoutedSession } from "../features/relay"
import { promptDeliveryState, SessionDetail } from "../features/session"

export function WorkspacePage({ initialBundle }: { initialBundle?: PairingBundle }) {
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
    ? relayState.loadCache<T>(selected.workspaceId, resource, selected.id)
    : Promise.resolve(undefined), [relayState.loadCache, selected?.workspaceId, selected?.id])
  const saveSelectedCache = useCallback(<T,>(resource: string, value: T) => selected
    ? relayState.saveCache(selected.workspaceId, resource, value, selected.id)
    : Promise.resolve(), [relayState.saveCache, selected?.workspaceId, selected?.id])
  const connectedRelayIds = relayState.relays.filter((relay) => relayState.isRelayConnected(relay.id)).map((relay) => relay.id)
  const connectionPresentation = effectiveConnectionPresentation(relayState.connection, connectedRelayIds, relayState.relays.length, relayState.relayHealth)
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
        <div className={`connection-state ${connectionPresentation.tone}`}>
          <button ref={connectionTriggerRef} className="connection-button" onClick={() => setConnectionDetailsOpen(true)} aria-haspopup="dialog" aria-expanded={connectionDetailsOpen} aria-controls="connection-status-dialog">
            {connectionPresentation.state === "online" ? <Wifi size={15} /> : <WifiOff size={15} />}
            {connectionPresentation.label}
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
            <IconButton aria-label="Disconnect" icon={<LogOut size={18} />} onClick={() => { history.replaceState({}, "", "/pair"); relayState.disconnect() }} />
          </section>

          <div className="section-heading">
            <span>Sessions</span>
            <div className="section-actions">
              <IconButton
                ref={newSessionTriggerRef}
                aria-label="New session"
                icon={<Plus size={18} />}
                onClick={() => setNewSessionOpen(true)}
              />
              <IconButton
                aria-label="Refresh sessions"
                icon={<RefreshCw size={17} />}
                onClick={() => void relayState.request({ type: "snapshot.request" })}
                disabled={relayState.connection !== "online"}
              />
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
        <div className="toast" role="alert"><AlertTriangle size={17} /><span>{relayState.error}</span><IconButton className="toast-dismiss" aria-label="Dismiss error" icon={<X size={16} />} onClick={() => relayState.setError(undefined)} /></div>
      )}
      {connectionDetailsOpen && <ConnectionDetails relayState={relayState} onClose={closeConnectionDetails} />}
      {newSessionOpen && <NewSessionDialog relays={relayState.relays} isConnected={relayState.isRelayConnected} onCreate={createSession} onClose={closeNewSession} />}
      {notificationPromptOpen && (
        <div className="notification-prompt-overlay" role="presentation">
          <section className="notification-prompt" role="dialog" aria-modal="true" aria-labelledby="notification-prompt-title">
            <IconButton className="notification-prompt-close" aria-label="Close notification prompt" title="Not now" icon={<X size={18} />} onClick={closeNotificationPrompt} />
            <span className="notification-prompt-icon"><Bell size={24} /></span>
            <p>Stay in the loop</p>
            <h2 id="notification-prompt-title">Enable Push notifications?</h2>
            <span>Get an alert when an agent finishes, asks a question, or needs approval.</span>
            <div>
              <Button onClick={closeNotificationPrompt}>Not now</Button>
              <Button
                variant="primary"
                loading={enablingNotifications}
                loadingLabel="Enable Push"
                startIcon={<Bell size={17} />}
                onClick={() => {
                  setEnablingNotifications(true)
                  void relayState.toggleNotifications().finally(() => {
                    setEnablingNotifications(false)
                    closeNotificationPrompt()
                  })
                }}
              >Enable Push</Button>
            </div>
          </section>
        </div>
      )}
    </main>
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
  const [now, setNow] = useState(() => Date.now())
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
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [])
  const refresh = () => { void relayState.request({ type: "snapshot.request" }).catch((error) => relayState.setError(error.message)) }
  const connectedRelayIds = relayState.relays.filter((relay) => relayState.isRelayConnected(relay.id)).map((relay) => relay.id)
  const overall = effectiveConnectionPresentation(relayState.connection, connectedRelayIds, relayState.relays.length, relayState.relayHealth)
  const service = serviceConnectionPresentation(relayState.serviceConnected, overall)
  const pwaBuild = useMemo(
    () => pwaBuildFromModuleScriptUrls([...document.querySelectorAll<HTMLScriptElement>('script[type="module"][src]')].map((script) => script.src), location.origin),
    [],
  )
  return (
    <div className="connection-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section ref={dialogRef} className="connection-dialog" id="connection-status-dialog" role="dialog" aria-modal="true" aria-labelledby="connection-title">
        <header><h2 id="connection-title">Connection status</h2><IconButton ref={closeRef} aria-label="Close connection status" title="Close" icon={<X size={18} />} onClick={onClose} /></header>
        <div className="connection-dialog-body"><div className={`connection-row ${service.state}`}><span>Remotty service</span><b>{service.label}</b></div>
        {relayState.relays.map((relay) => {
          const health = relayState.relayHealth[relay.id]
          const presentation = relayConnectionPresentation(relayState.isRelayConnected(relay.id), health, now)
          return <div className={`connection-row ${presentation.state}`} key={relay.id}><span>Your computer<small>{relay.name} . {relay.workspace}</small></span><b>{presentation.label}<small>{presentation.detail}</small></b></div>
        })}
        <div className="connection-row"><span>OpenCode data</span><b>{relayState.lastSyncedAt && now - relayState.lastSyncedAt < 60_000 ? "Current" : "Stale"}<small>{relayState.lastSyncedAt ? `Updated ${exactConnectionTime(relayState.lastSyncedAt, now)}` : "Not yet synced"}</small></b></div>
        <div className="connection-row"><span>PWA build</span><b><code>{pwaBuild}</code></b></div></div>
        <footer><Button onClick={onClose}>Close</Button><Button variant="primary" startIcon={<RefreshCw size={15} />} onClick={refresh}>Refresh</Button></footer>
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
        <header><h2 id="new-session-title">New session</h2><IconButton ref={closeRef} aria-label="Close new session" title="Close" icon={<X size={18} />} onClick={onClose} disabled={creating} /></header>
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
        <footer><Button onClick={onClose} disabled={creating}>Cancel</Button><Button variant="primary" loading={creating} loadingLabel="Create" startIcon={<Plus size={16} />} onClick={() => void create()} disabled={!relayId}>Create</Button></footer>
      </section>
    </div>
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
