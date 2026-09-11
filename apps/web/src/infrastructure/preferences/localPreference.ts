export interface LocalPreferenceOptions<T> {
  key: string
  defaultValue: T
  parse: (raw: string | null) => T
  serialize: (value: T) => string | null
}

// Values and updater results must be immutable. One instance owns each key.
export function createLocalPreference<T>(options: LocalPreferenceOptions<T>) {
  let snapshot = options.defaultValue
  let raw: string | null | undefined
  let memoryOnly = false
  const listeners = new Set<() => void>()
  const notify = () => listeners.forEach(listener => listener())
  const refresh = () => {
    if (memoryOnly || typeof window === "undefined") return
    let stored: string | null
    try { stored = window.localStorage.getItem(options.key) }
    catch { memoryOnly = true; return }
    if (stored === raw) return
    raw = stored
    try { snapshot = options.parse(stored) }
    catch { snapshot = options.defaultValue }
  }
  const getSnapshot = () => {
    // No listener was present to observe changes while unmounted.
    if (!listeners.size || raw === undefined) refresh()
    return snapshot
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key !== options.key && event.key !== null) return
    // Read current storage: an event may already be superseded by another write.
    refresh()
    notify()
  }
  const subscribe = (listener: () => void) => {
    if (!listeners.size && typeof window !== "undefined") {
      window.addEventListener("storage", onStorage)
      refresh()
    }
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
      if (!listeners.size && typeof window !== "undefined") window.removeEventListener("storage", onStorage)
    }
  }
  const set = (value: T) => {
    snapshot = value
    try {
      const stored = options.serialize(value)
      if (typeof window !== "undefined") {
        if (stored === null) window.localStorage.removeItem(options.key)
        else window.localStorage.setItem(options.key, stored)
      }
      raw = stored
    } catch {
      // A failed write must never let stale storage undo the user's choice.
      memoryOnly = true
    }
    notify()
  }
  const update = (updater: (current: T) => T) => set(updater(getSnapshot()))
  return { subscribe, getSnapshot, getServerSnapshot: () => options.defaultValue, set, update }
}

export type LocalPreference<T> = ReturnType<typeof createLocalPreference<T>>
