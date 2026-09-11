import { useEffect } from "react"

type NavigationMessage =
  | { type: "notification.navigation.probe"; version: 1 }
  | { type: "notification.navigation.open"; version: 1; sessionKey: string | null }

const standalone = () => window.matchMedia?.("(display-mode: standalone)").matches === true ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true

const trustedWorker = (event: MessageEvent, workers: ServiceWorkerContainer) => {
  if (event.origin && event.origin !== location.origin) return false
  const source = event.source
  if (typeof ServiceWorker === "undefined" || !(source instanceof ServiceWorker)) return false
  if (workers.controller && source !== workers.controller) return false
  // Uncontrolled installed windows can receive a probe from this app's worker too.
  const url = new URL(source.scriptURL)
  return url.origin === location.origin && ["/sw.js", "/dev-sw.js"].includes(url.pathname)
}

export function useNotificationNavigation(enrolled: boolean | undefined, selectSession: (key: string) => void) {
  useEffect(() => {
    const workers = navigator.serviceWorker
    if (!workers) return
    const receive = (event: MessageEvent<NavigationMessage>) => {
      if (!trustedWorker(event, workers) || event.data?.version !== 1) return
      if (event.data.type === "notification.navigation.probe") {
        const port = event.ports[0]
        if (port) {
          try { port.postMessage({ type: "notification.navigation.ready", version: 1, standalone: standalone(), ready: enrolled === true }) }
          finally { port.close() }
        }
        return
      }
      if (event.data.type !== "notification.navigation.open" || enrolled !== true || !standalone()) return
      const key = event.data.sessionKey
      if (key === null) return
      if (typeof key !== "string" || !key || key.length > 4097 || /[\u0000-\u001f\u007f]/.test(key)) return
      const url = new URL("/app", location.origin)
      url.searchParams.set("session", key)
      history.replaceState(history.state, "", url)
      selectSession(key)
    }
    workers.addEventListener("message", receive)
    return () => workers.removeEventListener("message", receive)
  }, [enrolled, selectSession])
}
