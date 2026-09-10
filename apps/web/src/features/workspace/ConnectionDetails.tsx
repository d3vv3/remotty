import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react"
import { RefreshCw, Wifi, WifiOff, X } from "lucide-react"
import { Button, Dialog, IconButton, StatusIndicator } from "../../components/ui"
import { pwaBuildFromModuleScriptUrls } from "../pwa"
import { effectiveConnectionPresentation, exactConnectionTime, relayConnectionPresentation, serviceConnectionPresentation, type useRelay } from "../relay"

export function ConnectionDetails({ relayState, onClose, triggerRef }: { relayState: ReturnType<typeof useRelay>; onClose: () => void; triggerRef?: RefObject<HTMLElement | null> }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [])
  const refresh = useCallback(() => { void relayState.request({ type: "snapshot.request" }).catch((error) => relayState.setError(error.message)) }, [relayState.request, relayState.setError])
  const connectedRelayIds = relayState.relays.filter((relay) => relayState.isRelayConnected(relay.id)).map((relay) => relay.id)
  const overall = effectiveConnectionPresentation(relayState.connection, connectedRelayIds, relayState.relays.length, relayState.relayHealth)
  const service = serviceConnectionPresentation(relayState.serviceConnected, overall)
  const pwaBuild = useMemo(
    () => pwaBuildFromModuleScriptUrls([...document.querySelectorAll<HTMLScriptElement>('script[type="module"][src]')].map((script) => script.src), location.origin),
    [],
  )
  return (
    <Dialog id="connection-status-dialog" className="connection-dialog connection-details" labelledBy="connection-title" onClose={onClose} initialFocusRef={closeRef} restoreFocusRef={triggerRef}>
      <header><h2 id="connection-title">Connection status</h2><IconButton ref={closeRef} aria-label="Close connection status" title="Close" icon={<X size={18} />} onClick={onClose} /></header>
       <div className="connection-dialog-body">
       <div className={`connection-summary ${overall.tone}`}>
         <span className="connection-summary-icon" aria-hidden="true">{overall.state === "online" ? <Wifi size={24} /> : <WifiOff size={24} />}</span>
         <div><strong>{overall.label}</strong><p>{overall.state === "online" ? "Your work is connected." : overall.state === "connecting" ? "Connecting to your workspaces..." : overall.state === "unstable" ? "Some updates may be delayed." : "Waiting to reconnect to your work."}</p></div>
       </div>
       <div className={`connection-row ${service.state}`}><span>Remotty service</span><b>{service.label}</b></div>
       <h3 id="connection-workspaces-title">Workspaces <span>{connectedRelayIds.length} connected</span></h3>
       <ul className="connection-workspaces" aria-labelledby="connection-workspaces-title">
      {relayState.relays.map((relay) => {
        const health = relayState.relayHealth[relay.id]
        const presentation = relayConnectionPresentation(relayState.isRelayConnected(relay.id), health, now)
         return <li className={`connection-workspace ${presentation.state}`} key={relay.id}>
           <div className="connection-workspace-heading"><strong>{relay.name}</strong><span><StatusIndicator state={presentation.state} />{presentation.label}</span></div>
           <p className="connection-workspace-path">{relay.workspace}</p>
           <dl className="connection-metrics">
             <div><dt>Latency</dt><dd>{health?.rtt !== undefined ? `${health.rtt} ms` : "Not measured"}</dd></div>
             <div><dt>Last contact</dt><dd>{health?.lastContact ? exactConnectionTime(health.lastContact, now) : "No contact yet"}</dd></div>
           </dl>
         </li>
       })}
       </ul>
       {relayState.relays.length === 0 && <p className="connection-empty">No connected workspaces yet.</p>}
      <div className="connection-row"><span>OpenCode data</span><b>{relayState.lastSyncedAt && now - relayState.lastSyncedAt < 60_000 ? "Current" : "Stale"}<small>{relayState.lastSyncedAt ? `Updated ${exactConnectionTime(relayState.lastSyncedAt, now)}` : "Not yet synced"}</small></b></div>
      <div className="connection-row"><span>PWA build</span><b><code>{pwaBuild}</code></b></div></div>
      <footer><Button onClick={onClose}>Close</Button><Button variant="primary" startIcon={<RefreshCw size={15} />} onClick={refresh}>Refresh</Button></footer>
    </Dialog>
  )
}
