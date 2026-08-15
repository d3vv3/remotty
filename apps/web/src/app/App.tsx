import { useEffect, useState } from "react"
import { CURRENT_IDENTITY_MARKER, loadCurrentIdentity } from "../infrastructure/storage"
import { pairingBundleFrom, routeForStoredIdentity } from "../features/pairing"
import { PwaUpdatePrompt } from "../features/pwa"
import { LandingPage, PrivacyPage, WorkspacePage } from "../pages"

let routePairingBundle = location.pathname === "/pair" && location.hash
  ? pairingBundleFrom(location.href)
  : undefined
if (routePairingBundle) history.replaceState({}, "", "/pair")

export function App() {
  const [pairingBundle] = useState(routePairingBundle)
  const [homeReady, setHomeReady] = useState(
    () => location.pathname !== "/" || !localStorage.getItem(CURRENT_IDENTITY_MARKER),
  )
  useEffect(() => {
    routePairingBundle = undefined
  }, [])
  useEffect(() => {
    if (homeReady || location.pathname !== "/") return
    let active = true
    void loadCurrentIdentity().then((identity) => {
      if (!active) return
      const route = routeForStoredIdentity(location.pathname, identity?.enrolled === true)
      if (route !== location.pathname) history.replaceState({}, "", route)
      setHomeReady(true)
    }).catch(() => {
      if (active) setHomeReady(true)
    })
    return () => { active = false }
  }, [homeReady])
  if (!homeReady) return <PwaUpdatePrompt />
  const page = location.pathname === "/" ? <LandingPage />
    : location.pathname === "/privacy" ? <PrivacyPage />
    : <WorkspacePage initialBundle={pairingBundle} />
  return <>{page}<PwaUpdatePrompt /></>
}
