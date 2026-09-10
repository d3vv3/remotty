import type { MouseEvent, ReactNode, RefObject } from "react"
import { useDialogFocus } from "../../hooks"

export type DialogProps = {
  labelledBy: string
  id?: string
  children: ReactNode
  onClose: () => void
  className?: string
  overlayClassName?: string
  busy?: boolean
  isolate?: boolean
  initialFocusRef?: RefObject<HTMLElement | null>
  restoreFocusRef?: RefObject<HTMLElement | null>
  restoreFocus?: boolean
}

export function Dialog({
  labelledBy,
  id,
  children,
  onClose,
  className = "connection-dialog",
  overlayClassName = "connection-overlay",
  busy = false,
  isolate = false,
  initialFocusRef,
  restoreFocusRef,
  restoreFocus = true,
}: DialogProps) {
  const dialogRef = useDialogFocus({ busy, isolate, onClose, initialFocusRef, restoreFocusRef, restoreFocus })
  const closeFromBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && !busy) onClose()
  }
  return (
    <div className={overlayClassName} role="presentation" onMouseDown={closeFromBackdrop}>
      <section ref={dialogRef} id={id} className={className} role="dialog" aria-modal="true" aria-labelledby={labelledBy} tabIndex={-1}>
        {children}
      </section>
    </div>
  )
}
