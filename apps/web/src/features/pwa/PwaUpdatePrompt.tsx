import { useEffect, useRef, useState } from "react"
import { RefreshCw } from "lucide-react"
import { useRegisterSW } from "virtual:pwa-register/react"
import { Button, Dialog } from "../../components/ui"
import { CURRENT_IDENTITY_MARKER } from "../../infrastructure/storage/deviceStore"
import { activatePwaUpdate, shouldShowPwaUpdate } from "./pwaUpdate"

export function PwaUpdatePrompt({ onVisibilityChange }: { onVisibilityChange?: (visible: boolean) => void } = {}) {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW()
  const [updateState, setUpdateState] = useState<"idle" | "activating" | "stalled" | "error">("idle")
  const [deferred, setDeferred] = useState(false)
  const updateActionRef = useRef<HTMLButtonElement>(null)
  const affordanceRef = useRef<HTMLButtonElement>(null)
  const pathname = location.pathname
  let paired = false
  try { paired = Boolean(localStorage.getItem(CURRENT_IDENTITY_MARKER)) } catch { /* Continue without persisted identity. */ }
  const visible = shouldShowPwaUpdate(needRefresh, pathname, paired)
  const updating = updateState === "activating"
  useEffect(() => {
    onVisibilityChange?.(visible && !deferred)
    return () => onVisibilityChange?.(false)
  }, [visible, deferred, onVisibilityChange])
  useEffect(() => {
    if (!needRefresh) setDeferred(false)
  }, [needRefresh])
  useEffect(() => {
    if (!visible) return
    if (deferred) {
      const underlyingDialog = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')]
        .find((dialog) => dialog !== updateActionRef.current?.closest('[role="dialog"]') && dialog.getClientRects().length > 0)
      const focusTarget = underlyingDialog?.querySelector<HTMLElement>("button:not([disabled])") ?? underlyingDialog ?? affordanceRef.current
      focusTarget?.focus()
      return
    }
    updateActionRef.current?.focus()
  }, [deferred, visible])
  if (!visible) return null

  const update = async () => {
    setUpdateState("activating")
    const result = await activatePwaUpdate({
      updateServiceWorker,
      serviceWorker: navigator.serviceWorker,
      reload: () => location.reload(),
    })
    if (result.status !== "reloading") setUpdateState(result.status)
  }

  if (deferred) return (
    <button ref={affordanceRef} className="pwa-update-affordance" type="button" aria-label="Update available" title="Update available" onClick={() => setDeferred(false)}>
      <RefreshCw size={16} /> <span>Update available</span>
    </button>
  )

  return (
    <Dialog labelledBy="pwa-update-title" className="notification-prompt update-prompt" overlayClassName="notification-prompt-overlay" onClose={() => setDeferred(true)} busy={updating} isolate initialFocusRef={updateActionRef} restoreFocus={false}>
        <span className="notification-prompt-icon"><RefreshCw size={24} /></span>
        <p>Update available</p>
        <h2 id="pwa-update-title">A new Remotty version is ready.</h2>
        <span>Update now to reload the PWA. To update later, close every Remotty tab and installed app window, then reopen it.</span>
        <strong>Update the desktop plugin too:</strong>
        <code tabIndex={0} aria-label="OpenCode plugin update command">opencode plugin opencode-remotty --global --force</code>
        <div>
          <Button disabled={updating} onClick={() => setDeferred(true)}>Later</Button>
          <Button ref={updateActionRef} variant="primary" loading={updating} loadingLabel="Updating" startIcon={<RefreshCw size={17} />} onClick={() => void update()}>{updateState === "idle" ? "Update now" : "Try again"}</Button>
        </div>
        {updateState === "stalled" && <p className="update-status" role="status">Update activation is taking longer than expected. Try again, reload the app, or update later.</p>}
        {updateState === "error" && <p className="update-status" role="alert">Could not start the update. Try again or reload the app.</p>}
        {(updateState === "stalled" || updateState === "error") && <Button className="update-reload" onClick={() => location.reload()}>Reload app</Button>}
    </Dialog>
  )
}
