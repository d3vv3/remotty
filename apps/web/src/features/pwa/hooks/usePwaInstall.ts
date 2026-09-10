import { useEffect, useRef, useState } from "react"

const seenKey = "remotty-install-prompt-seen"
let seenInMemory = false
interface InstallEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}
const wasSeen = () => {
  try { return seenInMemory || localStorage.getItem(seenKey) === "true" } catch { return seenInMemory }
}
const standalone = () => window.matchMedia?.("(display-mode: standalone)").matches === true
  || (navigator as Navigator & { standalone?: boolean }).standalone === true

export function usePwaInstall() {
  const deferred = useRef<InstallEvent | null>(null)
  const busy = useRef(false)
  const [available, setAvailable] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(false)
  const dismiss = () => {
    seenInMemory = true
    try { localStorage.setItem(seenKey, "true") } catch { /* Remember for this page lifetime. */ }
    deferred.current = null
    setAvailable(false)
  }

  useEffect(() => {
    const capture = (event: Event) => {
      const candidate = event as Partial<InstallEvent>
      if (typeof candidate.prompt !== "function" || !candidate.userChoice) return
      event.preventDefault()
      if (wasSeen() || standalone() || busy.current) return
      deferred.current = event as InstallEvent
      setError(false)
      setAvailable(true)
    }
    const mode = window.matchMedia?.("(display-mode: standalone)")
    const onModeChange = () => { if (standalone()) dismiss() }
    window.addEventListener("beforeinstallprompt", capture)
    window.addEventListener("appinstalled", dismiss)
    mode?.addEventListener("change", onModeChange)
    return () => {
      window.removeEventListener("beforeinstallprompt", capture)
      window.removeEventListener("appinstalled", dismiss)
      mode?.removeEventListener("change", onModeChange)
    }
  }, [])

  const install = async () => {
    const event = deferred.current
    if (!event || busy.current || wasSeen() || standalone()) return
    busy.current = true
    setPending(true)
    setError(false)
    try {
      // Keep this call synchronous with the button gesture; the browser owns the dialog.
      await event.prompt()
      await event.userChoice
      dismiss()
    } catch {
      setError(true)
    } finally {
      busy.current = false
      setPending(false)
    }
  }
  return { available, pending, error, install, dismiss }
}
