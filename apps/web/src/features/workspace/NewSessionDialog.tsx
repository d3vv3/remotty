import { useEffect, useMemo, useRef, useState, type RefObject } from "react"
import type { RelayInfo } from "@remotty/protocol"
import { Plus, X } from "lucide-react"
import { Button, Dialog, Field, IconButton } from "../../components/ui"
import { relaySupportsSessionCreate } from "../relay"
import { promptDeliveryState } from "../session"
import { folderName } from "./workspaceModel"

export function NewSessionDialog({ relays, isConnected, onCreate, onClose, triggerRef }: { relays: RelayInfo[]; isConnected: (relayId: string) => boolean; onCreate: (relayId: string) => Promise<void>; onClose: () => void; triggerRef?: RefObject<HTMLElement | null> }) {
  const available = useMemo(() => relays.filter((relay) => isConnected(relay.id) && relaySupportsSessionCreate(relay)), [isConnected, relays])
  const [relayId, setRelayId] = useState(() => available[0]?.id ?? "")
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string>()
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!available.some((relay) => relay.id === relayId)) setRelayId(available[0]?.id ?? "")
  }, [available, relayId])

  const create = async () => {
    if (!relayId || creating) return
    setCreating(true)
    setError(undefined)
    try {
      await onCreate(relayId)
    } catch (cause) {
      const message = (cause as Error).message
      setError(promptDeliveryState(message) === "uncertain" ? "Session creation outcome is uncertain. Refresh sessions before trying again." : message)
      setCreating(false)
    }
  }

  return (
    <Dialog labelledBy="new-session-title" className="connection-dialog new-session-dialog" onClose={onClose} busy={creating} initialFocusRef={closeRef} restoreFocusRef={triggerRef} restoreFocus={!creating}>
      <header><h2 id="new-session-title">New session</h2><IconButton ref={closeRef} aria-label="Close new session" title="Close" icon={<X size={18} />} onClick={onClose} disabled={creating} /></header>
      <div className="new-session-body">
        <Field id="new-session-workspace" label="Workspace" hint={relayId ? relays.find((relay) => relay.id === relayId)?.workspace : undefined} error={error}>
          {(controlProps) => <select {...controlProps} id="new-session-workspace" value={relayId} onChange={(event) => setRelayId(event.target.value)} disabled={creating}>
            {relays.map((relay) => {
              const connected = isConnected(relay.id)
              const supported = relaySupportsSessionCreate(relay)
              const suffix = !connected ? " (offline)" : !supported ? " (update plugin)" : ""
              return <option key={relay.id} value={relay.id} disabled={!connected || !supported}>{relay.name} - {folderName(relay.workspace)}{suffix}</option>
            })}
          </select>}
        </Field>
        {!available.length && <p className="form-error" role="status">No connected workspace supports session creation. Reconnect after updating the OpenCode plugin.</p>}
      </div>
      <footer><Button onClick={onClose} disabled={creating}>Cancel</Button><Button variant="primary" loading={creating} loadingLabel="Create" startIcon={<Plus size={16} />} onClick={() => void create()} disabled={!relayId}>Create</Button></footer>
    </Dialog>
  )
}
