import type { SessionSummary } from "@remotty/protocol"
import { Folder, MessageSquare } from "lucide-react"
import { StatusIndicator } from "../../components/ui"
import { folderName, relativeTime } from "./workspaceModel"

export function SessionRow({ session, needsInput, offline, selected, onSelect }: { session: SessionSummary; needsInput: boolean; offline: boolean; selected: boolean; onSelect: () => void }) {
  const state = offline ? "error" : needsInput ? "needs-input" : session.status
  const stateLabel = offline ? "Workspace offline" : needsInput ? "Needs input" : session.status === "idle" ? "Ready" : session.status === "error" ? "Error" : session.status === "retry" ? "Retrying" : "Working"
  const showLabel = stateLabel !== "Ready" && stateLabel !== "Working"
  return (
    <button className={`session-row ${selected ? "selected" : ""} ${state === "needs-input" ? "attention" : ""}`} aria-label={`${session.title}, ${stateLabel}, ${session.directory}`} aria-current={selected ? "true" : undefined} onClick={onSelect}>
      <span className={`session-avatar ${state}`} aria-hidden="true"><MessageSquare size={22} /></span>
      <span className="session-copy">
        <span className="session-row-title"><strong>{session.title}</strong><time>{relativeTime(session.updatedAt)}</time></span>
        {showLabel && <span className={`session-row-status ${state}`}><StatusIndicator state={state} />{stateLabel}</span>}
        <span className="session-row-folder" title={session.directory}><Folder size={14} aria-hidden="true" /><i>{folderName(session.directory)}</i></span>
      </span>
    </button>
  )
}
