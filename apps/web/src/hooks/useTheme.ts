import { useCallback, useSyncExternalStore } from "react"

export type RemottyTheme = "dark" | "light"

declare global {
  interface Window {
    remottyTheme?: {
      get: () => RemottyTheme
      set: (theme: RemottyTheme) => RemottyTheme
      refresh: () => void
    }
  }

  interface WindowEventMap {
    "remotty-theme-change": CustomEvent<{ theme: RemottyTheme }>
  }
}

const getTheme = (): RemottyTheme => window.remottyTheme?.get()
  ?? (document.documentElement.dataset.theme === "light" ? "light" : "dark")

const subscribe = (onChange: () => void) => {
  window.addEventListener("remotty-theme-change", onChange)
  return () => window.removeEventListener("remotty-theme-change", onChange)
}

export const useTheme = () => {
  const theme = useSyncExternalStore(subscribe, getTheme, () => "dark" as const)
  const setTheme = useCallback((next: RemottyTheme) => {
    if (window.remottyTheme) return window.remottyTheme.set(next)
    document.documentElement.dataset.theme = next
    document.documentElement.style.colorScheme = next
    window.dispatchEvent(new CustomEvent("remotty-theme-change", { detail: { theme: next } }))
    return next
  }, [])
  const toggleTheme = useCallback(() => setTheme(theme === "dark" ? "light" : "dark"), [setTheme, theme])

  return { theme, setTheme, toggleTheme } as const
}
