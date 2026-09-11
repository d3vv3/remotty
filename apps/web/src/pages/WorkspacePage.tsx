import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Bell, BellOff, Check, Code2, Folder, Github, LoaderCircle, LogOut, Plus, RefreshCw, Settings2, Wifi, WifiOff } from "lucide-react"
import type { PairingBundle } from "@remotty/protocol"
import { Button, EmptyState, ErrorToast, IconButton, ThemeControl } from "../components/ui"
import { clearNotificationPromptSeen, markNotificationPromptSeen, notificationPromptWasSeen, shouldOfferPushNotifications } from "../features/notifications"
import { PairingScreen, routeForEnrollment } from "../features/pairing"
import { effectiveConnectionPresentation, stableWorkspaceKey, useRelay, workspaceSessionKey } from "../features/relay"
import { SessionDetail } from "../features/session"
import { ConnectionDetails, isSessionVisibleInList, NewSessionDialog, NotificationPrompt, SESSION_LIST_MAX_AGE_MS, SessionRow, sessionKey } from "../features/workspace"
import { useSessionFilters } from "../features/workspace/hooks/useSessionFilters"
import { useHorizontalOverflow } from "../hooks/useHorizontalOverflow"
import { useVisualViewport } from "../hooks/useVisualViewport"
import { useDismissibleDetails } from "../hooks/useDismissibleDetails"
import { PwaInstallPrompt } from "../features/pwa/PwaInstallPrompt"
import { useNotificationNavigation } from "../features/notifications/hooks/useNotificationNavigation"

export { SESSION_LIST_MAX_AGE_MS, isSessionVisibleInList }

export function WorkspacePage({ initialBundle }: { initialBundle?: PairingBundle }) {
  const relayState = useRelay(initialBundle)
  const viewportStyle = useVisualViewport()
  const utilitiesRef = useDismissibleDetails()
  const [connectionDetailsOpen, setConnectionDetailsOpen] = useState(false)
  const connectionTriggerRef = useRef<HTMLButtonElement>(null)
  const [newSessionOpen, setNewSessionOpen] = useState(false)
  const newSessionTriggerRef = useRef<HTMLButtonElement>(null)
  const [focusSessionKey, setFocusSessionKey] = useState<string>()
  const [selectedKey, setSelectedKey] = useState<string | undefined>(
    () => new URLSearchParams(location.search).get("session") ?? undefined,
  )
  useNotificationNavigation(relayState.enrolled, setSelectedKey)
  const [notificationPromptOpen, setNotificationPromptOpen] = useState(false)
  const [clock, setClock] = useState(() => Date.now())
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
  // Connection membership is read through a stable callback backed by a ref.
  const eligibleSessions = relayState.sessions.filter(
    (session) => relayState.isRelayConnected(session.workspaceRelayId) && isSessionVisibleInList(session, clock),
  )
  const attentionKeys = useMemo(() => new Set([
    ...relayState.permissions.map((item) => `${item.workspaceRelayId}:${item.sessionID}`),
    ...relayState.questions.map((item) => `${item.workspaceRelayId}:${item.sessionID}`),
  ]), [relayState.permissions, relayState.questions])
  const { folders, filteredSessions: visibleSessions, toggleFolder, showAllFolders } = useSessionFilters(eligibleSessions, attentionKeys)
  const { scrollRef: folderFiltersRef, hasOverflowRight: foldersOverflowRight } = useHorizontalOverflow(JSON.stringify(folders.map(folder => [folder.directory, folder.label])))
  const visibleAttentionCount = visibleSessions.filter((session) => attentionKeys.has(`${session.workspaceRelayId}:${session.id}`)).length

  useEffect(() => {
    if (!relayState.error) return
    const timeout = window.setTimeout(() => relayState.setError(undefined), 6_000)
    return () => window.clearTimeout(timeout)
  }, [relayState.error])
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 30_000)
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
      seen: notificationPromptWasSeen(),
    })) setNotificationPromptOpen(true)
  }, [relayState.connection, relayState.relay, relayState.notificationsEnabled])

  const closeNotificationPrompt = () => {
    markNotificationPromptSeen()
    setNotificationPromptOpen(false)
  }
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

  useEffect(() => {
    const route = routeForEnrollment(relayState.enrolled)
    if (route && location.pathname !== route) history.replaceState({}, "", route)
  }, [relayState.enrolled])

  if (relayState.enrolled !== true &&
    (location.pathname === "/pair" || (relayState.connection === "disconnected" && !relayState.relay))) {
    return (
      <PairingScreen
        onConnect={(bundle) => {
          clearNotificationPromptSeen()
          void relayState.connect(bundle)
        }}
        error={relayState.error}
      />
    )
  }

  return (
    <main className={`app-shell ${selected ? "has-selection" : ""}`} style={viewportStyle}>
      <div className="workspace-layout">
        <aside aria-label="Workspace navigator" className={`session-panel ${selected ? "mobile-hidden" : ""}`}>
          <header className="navigator-header">
            <div>
              <div className="inbox-brand"><span className="brand-mark"><Code2 size={20} /></span>Remotty</div>
              <h1>Your sessions<span className="inbox-count">{visibleSessions.length}</span></h1>
              <p>{relayState.relays.length > 1 ? `${connectedRelayIds.length} connected ${connectedRelayIds.length === 1 ? "workspace" : "workspaces"}` : relayState.relay?.name ?? "Connecting to your workspace"}</p>
              {visibleAttentionCount > 0 && <p className="navigator-attention">{visibleAttentionCount} {visibleAttentionCount === 1 ? "session needs" : "sessions need"} your attention</p>}
            </div>
            <details ref={utilitiesRef} className="inbox-utilities">
              <summary aria-label="Settings"><Settings2 size={21} /></summary>
              <div>
                <span>Appearance <ThemeControl /></span>
                <a href="https://github.com/d3vv3/remotty" target="_blank" rel="noreferrer"><Github size={18} />View source</a>
                <button onClick={() => { history.replaceState({}, "", "/pair"); relayState.disconnect() }}><LogOut size={18} />Disconnect</button>
              </div>
            </details>
          </header>

          <div className="section-heading">
            <div className="section-actions">
              <Button
                ref={newSessionTriggerRef}
                variant="primary"
                aria-label="New session"
                startIcon={<Plus size={20} />}
                onClick={() => setNewSessionOpen(true)}
              >New session</Button>
              <IconButton
                aria-label="Refresh sessions"
                icon={<RefreshCw size={17} />}
                onClick={() => void relayState.request({ type: "snapshot.request" })}
                disabled={relayState.connection !== "online"}
              />
            </div>
          </div>
          {folders.length > 0 && <div className="folder-filters-row" data-overflow-right={foldersOverflowRight}>
            <div ref={folderFiltersRef} className="folder-filters" role="group" aria-label="Filter by folder">
            {folders.map(folder => <Button key={folder.directory} className="folder-filter" title={folder.directory}
              aria-label={folder.directory} aria-pressed={folder.enabled} onClick={() => toggleFolder(folder.directory)}
              startIcon={folder.enabled ? <Check size={14} /> : <Folder size={14} />}>
              <span>{folder.label}</span>
            </Button>)}
            </div>
          </div>}
          <div className="session-list">
            <PwaInstallPrompt eligible={relayState.enrolled === true && !selected && !notificationPromptOpen && !connectionDetailsOpen && !newSessionOpen} />
            {visibleSessions.map((session) => (
              <SessionRow
                key={sessionKey(session)}
                session={session}
                selected={selected !== undefined && sessionKey(session) === sessionKey(selected)}
                needsInput={attentionKeys.has(`${session.workspaceRelayId}:${session.id}`)}
                offline={!relayState.isRelayConnected(session.workspaceRelayId)}
                onSelect={() => { relayState.setError(undefined); setSelectedKey(sessionKey(session)) }}
              />
            ))}
            {visibleSessions.length === 0 && eligibleSessions.length > 0 && <EmptyState icon={<Folder size={22} />}>
              <p>No folders selected.</p>
              <Button onClick={showAllFolders}>Show all folders</Button>
            </EmptyState>}
            {eligibleSessions.length === 0 && (
              <EmptyState icon={relayState.serviceConnected && connectedRelayIds.length === 0
                ? <WifiOff size={22} />
                : <LoaderCircle size={22} className={relayState.serviceConnected ? "" : "spin"} />}>
                <p>
                  {relayState.serviceConnected
                    ? connectedRelayIds.length === 0
                      ? "No connected workspace sessions."
                      : "Open a new OpenCode session to get started."
                    : "Waiting for the local relay."}
                </p>
              </EmptyState>
            )}
          </div>
          <footer className="topbar">
            <div className={`connection-state ${connectionPresentation.tone}`}>
              <button ref={connectionTriggerRef} className="connection-button" onClick={() => setConnectionDetailsOpen(true)} aria-haspopup="dialog" aria-expanded={connectionDetailsOpen} aria-controls="connection-status-dialog">
                {connectionPresentation.state === "online" ? <Wifi size={15} /> : <WifiOff size={15} />}
                {connectionPresentation.label}
              </button>
              <button
                className={`notification-button ${relayState.notificationsEnabled ? "enabled" : ""}`}
                title={relayState.notificationsEnabled ? "Disable notifications" : "Enable notifications"}
                aria-label={relayState.notificationsEnabled ? "Disable notifications" : "Enable notifications"}
                aria-pressed={relayState.notificationsEnabled}
                onClick={() => void relayState.toggleNotifications()}
              >
                {relayState.notificationsEnabled ? <Bell size={15} /> : <BellOff size={15} />}
                <span>Notifications</span>
              </button>
            </div>
          </footer>
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
        <ErrorToast message={relayState.error} onDismiss={() => relayState.setError(undefined)} />
      )}
      {connectionDetailsOpen && <ConnectionDetails relayState={relayState} onClose={() => setConnectionDetailsOpen(false)} triggerRef={connectionTriggerRef} />}
      {newSessionOpen && <NewSessionDialog relays={relayState.relays} isConnected={relayState.isRelayConnected} onCreate={createSession} onClose={() => setNewSessionOpen(false)} triggerRef={newSessionTriggerRef} />}
      {notificationPromptOpen && <NotificationPrompt onEnable={relayState.toggleNotifications} onClose={closeNotificationPrompt} />}
    </main>
  )
}
