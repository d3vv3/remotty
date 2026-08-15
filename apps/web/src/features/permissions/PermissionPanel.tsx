import { useEffect, useRef, useState } from "react"
import { Check, ShieldAlert, X } from "lucide-react"
import type { PermissionRequest } from "@remotty/protocol"
import { Button, IconButton } from "../../components/ui"
import { createPermissionSubmissionGuard, isPermissionRequestNotFoundError, type PermissionResponse } from "./permissionSubmission"

export function PermissionPanel({ permission, request, onError }: { permission: PermissionRequest; request: (command: any) => Promise<unknown>; onError: (error?: string) => void }) {
  const guardRef = useRef(createPermissionSubmissionGuard())
  const [, setSubmissionRevision] = useState(0)
  const guard = guardRef.current
  const currentState = guard.state()
  const pending = currentState.permissionId === permission.id ? currentState.pending : undefined
  useEffect(() => {
    const requestToken = guard.activate(permission.id).token!
    setSubmissionRevision((revision) => revision + 1)
    return () => { guard.invalidate(requestToken) }
  }, [guard, permission.id])
  const reply = async (response: PermissionResponse) => {
    const permissionId = permission.id
    const requestToken = guard.state().token
    if (requestToken === undefined) return
    if (!guard.begin(permissionId, response, requestToken)) return
    setSubmissionRevision((revision) => revision + 1)
    try {
      await request({
        type: "permission.reply",
        sessionId: permission.targetSessionID ?? permission.sessionID,
        permissionId,
        response,
        ...(permission.replyDialect ? { replyDialect: permission.replyDialect } : {}),
      })
      if (!guard.isActive(permissionId, requestToken)) return
      // Keep the controls locked until the matching relay event or snapshot replaces this request.
    } catch (error) {
      if (!guard.isActive(permissionId, requestToken)) return
      if (isPermissionRequestNotFoundError(error)) {
        try {
          await request({ type: "snapshot.request" })
          if (!guard.isActive(permissionId, requestToken)) return
          return
        } catch (snapshotError) {
          if (!guard.isActive(permissionId, requestToken)) return
          guard.unlock(permissionId, requestToken)
          setSubmissionRevision((revision) => revision + 1)
          onError("Permission status refresh failed.")
          return
        }
      }
      guard.unlock(permissionId, requestToken)
      setSubmissionRevision((revision) => revision + 1)
      onError(error instanceof Error ? error.message : String(error))
    }
  }

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
        <IconButton variant="permission" aria-label="Reject" icon={<X size={17} />} loading={pending === "reject"} disabled={Boolean(pending)} onClick={() => void reply("reject")} />
        <Button variant="permission" size="sm" loading={pending === "once"} startIcon={<Check size={17} />} disabled={Boolean(pending)} onClick={() => void reply("once")}>Once</Button>
        <Button variant="permission" size="sm" loading={pending === "always"} startIcon={<Check size={17} />} disabled={Boolean(pending)} onClick={() => void reply("always")}>Always</Button>
      </div>
    </section>
  )
}
