import { useState } from "react"
import { ChevronDown, LoaderCircle } from "lucide-react"
import { Notice, WarningNotice } from "../../../components/ui"
import type { FileDiff, WorkspacePatch } from "../model/sessionContent"

function ChangeEntry({ diff, sessionId, request, onError }: { diff: FileDiff; sessionId: string; request: (command: any) => Promise<unknown>; onError: (error?: string) => void }) {
  const [patch, setPatch] = useState(diff.patch)
  const [patchState, setPatchState] = useState<"idle" | "loading" | "ready" | "error">(diff.patch ? "ready" : "idle")
  const [patchTruncated, setPatchTruncated] = useState(Boolean(diff.truncated))
  const loadPatch = async () => {
    if (patchState !== "idle" || diff.status === "untracked" || !diff.status) return
    setPatchState("loading")
    try {
      const result = await request({ type: "workspace.diff.patch", sessionId, file: diff.file }) as WorkspacePatch
      if (!result || typeof result.truncated !== "boolean" || (result.patch !== undefined && typeof result.patch !== "string")) throw new Error("The relay returned an invalid file patch.")
      setPatch(result.patch); setPatchTruncated(result.truncated); setPatchState("ready")
    } catch (error) { setPatchState("error"); onError((error as Error).message) }
  }
  return <details className="change-entry" onToggle={(event) => { if (event.currentTarget.open) void loadPatch() }}>
    <summary className="change-row"><small className={`change-status ${diff.status ?? "modified"}`}>{diff.status ?? "changed"}</small><code>{diff.file}</code><span><b>+{diff.additions}</b><i>-{diff.deletions}</i></span><ChevronDown size={15} /></summary>
    <div className="change-patch">{patchState === "loading" ? <p><LoaderCircle className="spin" size={15} /> Loading patch</p> : patch ? <pre><code>{patch}</code></pre> : <p>{diff.status === "untracked" ? "Untracked file content is not transferred automatically." : !diff.status ? "Update the workspace plugin to view this patch." : diff.binary ? "Binary file changed." : patchTruncated ? "Patch is too large to display." : patchState === "error" ? "Patch could not be loaded." : "No textual patch is available."}</p>}</div>
  </details>
}

export function Changes({ diffs, state, truncated, version, directory, sessionId, request, onError }: { diffs: FileDiff[]; state: "idle" | "loading" | "ok" | "not_git" | "error"; truncated: boolean; version: number; directory: string; sessionId: string; request: (command: any) => Promise<unknown>; onError: (error?: string) => void }) {
  return <div className="change-list">
    {state === "loading" && <div className="empty-state"><LoaderCircle className="spin" size={22} /></div>}
    {diffs.map((diff) => <ChangeEntry key={`${version}:${diff.file}`} diff={diff} sessionId={sessionId} request={request} onError={onError} />)}
    {truncated && <WarningNotice>Some files were omitted because the workspace contains more than 500 changes.</WarningNotice>}
    {state === "not_git" && <div className="empty-state"><p>{directory} is not a Git working tree.</p></div>}
    {state === "ok" && diffs.length === 0 && <div className="empty-state"><p>The working tree matches the latest commit.</p></div>}
    {state === "error" && <Notice tone="error">Workspace changes could not be loaded.</Notice>}
  </div>
}
