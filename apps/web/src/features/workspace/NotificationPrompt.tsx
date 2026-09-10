import { useRef, useState } from "react"
import { Bell, X } from "lucide-react"
import { Button, Dialog, IconButton } from "../../components/ui"

export function NotificationPrompt({ onEnable, onClose }: { onEnable: () => Promise<unknown>; onClose: () => void }) {
  const [enabling, setEnabling] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)
  const enable = () => {
    setEnabling(true)
    void onEnable().finally(onClose)
  }
  return (
    <Dialog labelledBy="notification-prompt-title" className="notification-prompt" overlayClassName="notification-prompt-overlay" onClose={onClose} busy={enabling} initialFocusRef={closeRef}>
      <IconButton ref={closeRef} className="notification-prompt-close" aria-label="Close notification prompt" title="Not now" icon={<X size={18} />} onClick={onClose} disabled={enabling} />
      <span className="notification-prompt-icon"><Bell size={24} /></span>
      <p>Stay in the loop</p>
      <h2 id="notification-prompt-title">Enable Push notifications?</h2>
      <span>Get an alert when an agent finishes, asks a question, or needs approval.</span>
      <div>
        <Button onClick={onClose} disabled={enabling}>Not now</Button>
        <Button variant="primary" loading={enabling} loadingLabel="Enable Push" startIcon={<Bell size={17} />} onClick={enable}>Enable Push</Button>
      </div>
    </Dialog>
  )
}
