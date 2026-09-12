import type { ClientCommand } from "@remotty/protocol"
import { assembledMessages, completeChunks, exactManifestMessages, orderByManifest, type ChunkAssembly } from "./messageTransfer"
import { stableWorkspaceKey, type RelaySlice } from "./relayState"

export type RelayRequest = ClientCommand extends infer Command
  ? Command extends { requestId: string } ? Omit<Command, "requestId"> : never
  : never

export const notificationsEnabledFromStorage = (readPreference: () => string | null, permission: NotificationPermission | undefined) => {
  try {
    return readPreference() === "enabled" && permission === "granted"
  } catch {
    return false
  }
}

type ProgressPending = {
  progress?: (messages: unknown[], isActive: () => boolean) => void | Promise<void>
  progressChain: Promise<void>
  progressSignature?: string
  completionScheduled: boolean
}

export const verifiedCanonicalMessages = <T>(messages: T[], verified: ReadonlySet<string>) => {
  const seen = new Set<string>()
  return messages.filter((message) => {
    const id = (message as { info?: { id?: unknown } }).info?.id
    if (typeof id !== "string" || !id || !verified.has(id) || seen.has(id)) return false
    seen.add(id)
    return true
  })
}

export const legacyManifestCompatible = (chunks: ChunkAssembly, total: number) =>
  chunks.total === undefined || chunks.total === total

export const cacheNamespace = (cacheRelayId: string, relay?: Pick<RelaySlice["relay"], "workspaceId" | "hostname" | "workspace">) =>
  relay ? stableWorkspaceKey(relay) : cacheRelayId

export const legacyChunkState = (chunks: ChunkAssembly, manifestIds: string[] | undefined, verified: ReadonlySet<string>) => {
  const messages = assembledMessages(chunks)
  if (!manifestIds) return { progress: [] as unknown[], complete: false as const }
  const progress = verifiedCanonicalMessages(orderByManifest(messages, manifestIds), verified)
  if (!completeChunks(chunks)) return { progress, complete: false as const }
  return { progress, complete: true as const, messages: exactManifestMessages(messages, manifestIds) }
}

export const queueProgress = (pending: Pick<ProgressPending, "progress" | "progressChain">, messages: unknown[], onFailure?: (cause: unknown) => void, isActive: () => boolean = () => true) => {
  if (!messages.length || !pending.progress) return pending.progressChain
  pending.progressChain = pending.progressChain.then(() => isActive() ? pending.progress?.(messages, isActive) : undefined)
  void pending.progressChain.catch((cause) => { onFailure?.(cause) })
  return pending.progressChain
}

const progressSignature = (messages: unknown[]) => JSON.stringify(messages.map((message) => (message as { info?: { id?: unknown } }).info?.id))

export const queueProgressSnapshot = (pending: Pick<ProgressPending, "progress" | "progressChain" | "progressSignature" | "completionScheduled">, messages: unknown[], isActive: () => boolean, onFailure?: (cause: unknown) => void) => {
  if (!messages.length || !pending.progress || pending.completionScheduled) return pending.progressChain
  const signature = progressSignature(messages)
  if (signature === pending.progressSignature) return pending.progressChain
  pending.progressSignature = signature
  return queueProgress(pending, messages, onFailure, isActive)
}

export const commandForRelayCapabilities = (command: RelayRequest, capabilities?: { attachmentRead?: 1; messageChunks?: boolean; messageDelta?: 1; promptMessageId?: 1; relayPromptMessageId?: 1; workspaceDiff?: 1 }): RelayRequest => {
  if (command.type === "attachment.get" && !capabilities?.attachmentRead) throw new Error("Update the workspace plugin to load this attachment.")
  if (command.type === "session.messages") {
    const { attachments: _attachments, ...base } = command
    command = capabilities?.attachmentRead ? { ...base, attachments: "references-v1" } : base
  }
  if (command.type === "session.prompt") {
    const { messageId: _messageId, ...legacy } = command
    return legacy
  }
  if (command.type === "session.messages" && capabilities?.messageDelta && command.sync) return command
  if (command.type === "session.messages" && capabilities?.messageChunks) return { ...command, chunked: true, sync: undefined }
  if (command.type === "workspace.diff" && !capabilities?.workspaceDiff) return { type: "session.diff", sessionId: command.sessionId }
  return command
}
