import type { MessageCache } from "./messageCache"

export type SessionResourceRevisions = { messages: number; todos: number; diffs: number }
export type RetainedSessionState = {
  draft?: string
  tab?: "activity" | "todos" | "changes" | "subagents"
  agent?: string
  selectedChildId?: string
  messages?: unknown[]
  messageCache?: MessageCache<any>
  todos?: unknown[]
  diffs?: unknown[]
  diffState?: "idle" | "loading" | "ok" | "not_git" | "error"
  diffTruncated?: boolean
  refreshed?: Partial<SessionResourceRevisions>
}

/** Bounded LRU store deliberately kept outside React so token updates stay local. */
export const createSessionStateStore = (limit = 75) => {
  const entries = new Map<string, RetainedSessionState>()
  const read = (key: string) => {
    const value = entries.get(key)
    if (!value) return undefined
    entries.delete(key)
    entries.set(key, value)
    return value
  }
  const write = (key: string, update: Partial<RetainedSessionState>) => {
    const value = { ...(read(key) ?? {}), ...update }
    entries.set(key, value)
    while (entries.size > limit) entries.delete(entries.keys().next().value!)
    return value
  }
  return { read, write, clear: () => entries.clear(), size: () => entries.size, keys: () => [...entries.keys()] }
}

export const retainedSessionState = createSessionStateStore()
export const clearSubmittedDraft = (current: string, submitted: string) => current === submitted ? "" : current
export const needsMessageRefresh = (retained: RetainedSessionState | undefined, revision: number) => retained?.refreshed?.messages !== revision
export const resourceArray = (value: unknown) => {
  if (Array.isArray(value)) return value
  if (!value || typeof value !== "object" || !("deltaManifest" in value)) return undefined
  const messages = (value as { messages?: unknown }).messages
  return Array.isArray(messages) ? messages : undefined
}
