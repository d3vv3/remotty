import { useSyncExternalStore } from "react"
import type { LocalPreference } from "../infrastructure/preferences/localPreference"

export function usePreference<T>(preference: LocalPreference<T>) {
  const value = useSyncExternalStore(preference.subscribe, preference.getSnapshot, preference.getServerSnapshot)
  return [value, preference.set] as const
}
