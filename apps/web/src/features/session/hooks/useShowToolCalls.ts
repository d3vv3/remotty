import { useSyncExternalStore } from "react"

const key = "remotty.show-tool-calls"
let fallback = true
let storageAvailable = true
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((listener) => listener())
function read() {
  if (!storageAvailable) return fallback
  try {
    const value = window.localStorage.getItem(key)
    fallback = value !== "false"
  } catch { storageAvailable = false }
  return fallback
}
function subscribe(listener: () => void) {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (event.key === key || event.key === null) {
      fallback = event.newValue !== "false"
      notify()
    }
  }
  window.addEventListener("storage", onStorage)
  return () => { listeners.delete(listener); window.removeEventListener("storage", onStorage) }
}
function setShowToolCalls(value: boolean) {
  fallback = value
  try { window.localStorage.setItem(key, String(value)) } catch { storageAvailable = false }
  notify()
}

export function useShowToolCalls() {
  return [useSyncExternalStore(subscribe, read, () => true), setShowToolCalls] as const
}
