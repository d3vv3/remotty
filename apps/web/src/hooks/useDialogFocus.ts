import { useEffect, useRef, type RefObject } from "react"

const focusableSelector = "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"

export type UseDialogFocusOptions = {
  enabled?: boolean
  busy?: boolean
  isolate?: boolean
  onClose: () => void
  initialFocusRef?: RefObject<HTMLElement | null>
  restoreFocusRef?: RefObject<HTMLElement | null>
  restoreFocus?: boolean
}

export function useDialogFocus({
  enabled = true,
  busy = false,
  isolate = false,
  onClose,
  initialFocusRef,
  restoreFocusRef,
  restoreFocus = true,
}: UseDialogFocusOptions) {
  const dialogRef = useRef<HTMLElement>(null)
  const busyRef = useRef(busy)
  const onCloseRef = useRef(onClose)
  const restoreRef = useRef(restoreFocus)
  const restoreFrameRef = useRef<number | undefined>(undefined)
  const restoreTargetRef = useRef<HTMLElement | undefined>(undefined)
  busyRef.current = busy
  onCloseRef.current = onClose
  restoreRef.current = restoreFocus

  useEffect(() => {
    if (!enabled) return
    const pendingRestoreFrame = restoreFrameRef.current
    const continuingSetup = pendingRestoreFrame !== undefined
    if (continuingSetup) {
      cancelAnimationFrame(pendingRestoreFrame)
      restoreFrameRef.current = undefined
    }
    const dialog = dialogRef.current
    if (!continuingSetup) restoreTargetRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    ;(initialFocusRef?.current ?? dialog?.querySelector<HTMLElement>(focusableSelector) ?? dialog)?.focus()

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        if (isolate) event.stopImmediatePropagation()
        if (busyRef.current) {
          event.preventDefault()
          return
        }
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== "Tab") return
      if (isolate) event.stopImmediatePropagation()
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])]
      if (!focusable.length) {
        event.preventDefault()
        dialogRef.current?.focus()
        return
      }
      const first = focusable[0]!
      const last = focusable.at(-1)!
      const active = document.activeElement
      if (event.shiftKey && (active === first || !dialogRef.current?.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !dialogRef.current?.contains(active))) {
        event.preventDefault()
        first.focus()
      }
    }

    window.addEventListener("keydown", handleKeyDown, isolate)
    return () => {
      window.removeEventListener("keydown", handleKeyDown, isolate)
      if (restoreRef.current) {
        restoreFrameRef.current = requestAnimationFrame(() => {
          restoreFrameRef.current = undefined
          ;(restoreFocusRef?.current ?? restoreTargetRef.current)?.focus()
          restoreTargetRef.current = undefined
        })
      }
    }
  }, [enabled, initialFocusRef, isolate, restoreFocusRef])

  return dialogRef
}
