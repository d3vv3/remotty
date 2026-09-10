import type { DeliveryState } from "./messagePresentation"

export type MessagePart = {
  type: string
  text?: string
  tool?: string
  time?: { start?: number; end?: number }
  state?: {
    status?: string
    title?: string
    input?: Record<string, unknown>
    output?: string
    error?: string
    metadata?: Record<string, unknown>
  }
}

export type SessionMessage = {
  info: {
    id: string
    role: string
    parentID?: string
    time?: { created?: number }
    delivery?: DeliveryState
    legacyPrompt?: boolean
    knownMessageIds?: string[]
  }
  parts: MessagePart[]
}

export type FileDiff = {
  file: string
  status?: "added" | "modified" | "deleted" | "untracked"
  additions: number
  deletions: number
  patch?: string
  binary?: boolean
  truncated?: boolean
}

export type WorkspaceDiff = { state: "ok" | "not_git"; files: FileDiff[]; truncated: boolean }
export type WorkspacePatch = { patch?: string; truncated: boolean }
export type SessionTodo = { id: string; content: string; status: string; priority: string }

export const limited = (value: string, limit: number) => value.length > limit ? `${value.slice(0, limit)}\n\n[output truncated]` : value

export const relativeTime = (time: number) => {
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1_000))
  if (seconds < 60) return "now"
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h`
  return `${Math.floor(seconds / 86_400)}d`
}
