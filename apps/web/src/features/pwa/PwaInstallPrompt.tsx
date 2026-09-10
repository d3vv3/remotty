import { createContext, useContext } from "react"
import { Download, X } from "lucide-react"
import { Button, IconButton } from "../../components/ui"
import type { usePwaInstall } from "./hooks/usePwaInstall"

export const PwaInstallContext = createContext<ReturnType<typeof usePwaInstall> | null>(null)
export const PwaUpdateVisibleContext = createContext(false)

export function PwaInstallPrompt({ eligible }: { eligible: boolean }) {
  const install = useContext(PwaInstallContext)
  const updateVisible = useContext(PwaUpdateVisibleContext)
  if (!eligible || updateVisible || !install?.available) return null
  return (
    <section className="pwa-install-invitation" aria-label="Install Remotty">
      <div>
        <strong>Remotty, one tap away</strong>
        <p>Add it to your home screen for quick access.</p>
        <Button startIcon={<Download size={16} />} disabled={install.pending} onClick={() => void install.install()}>
          {install.pending ? "Installing..." : "Install Remotty"}
        </Button>
        {install.error && <p role="status">Could not open the install dialog. Try again.</p>}
      </div>
      <IconButton aria-label="Dismiss install invitation" icon={<X size={16} />} disabled={install.pending} onClick={install.dismiss} />
    </section>
  )
}
