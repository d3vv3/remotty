import { X } from "lucide-react"
import { IconButton } from "./Button"
import { Notice } from "./Notice"

export function ErrorToast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return <Notice tone="error" className="ui-toast" action={
    <IconButton className="ui-toast-dismiss" aria-label="Dismiss error" icon={<X size={18} aria-hidden="true" />} onClick={onDismiss} />
  }>{message}</Notice>
}
