import { z } from "zod"
import type { JsonValue } from "./e2ee"

export * from "./e2ee-schema"
export * from "./e2ee"

export const sessionStatusSchema = z.enum(["busy", "idle", "retry", "error"])
export type SessionStatus = z.infer<typeof sessionStatusSchema>

export const sessionSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  directory: z.string(),
  branch: z.string().nullish().transform((branch) => branch ?? undefined),
  agent: z.string().optional(),
  status: sessionStatusSchema,
  updatedAt: z.number(),
  additions: z.number().default(0),
  deletions: z.number().default(0),
  files: z.number().default(0),
})
export type SessionSummary = z.infer<typeof sessionSummarySchema>

export const agentSummarySchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  mode: z.enum(["primary", "all"]),
  color: z.string().optional(),
})
export type AgentSummary = z.infer<typeof agentSummarySchema>

export const permissionRequestSchema = z.object({
  id: z.string(),
  sessionID: z.string(),
  targetSessionID: z.string().optional(),
  replyDialect: z.enum(["standard", "v2"]).optional(),
  permission: z.string(),
  patterns: z.array(z.string()),
  metadata: z.record(z.string(), z.unknown()).default({}),
  always: z.array(z.string()).default([]),
})
export type PermissionRequest = z.infer<typeof permissionRequestSchema>

export const relayInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  hostname: z.string(),
  platform: z.string(),
  arch: z.string(),
  workspace: z.string(),
  version: z.string().optional(),
  instanceId: z.string().optional(),
  instanceStartedAt: z.number().int().nonnegative().optional(),
  workspaceId: z.string().optional(),
  capabilities: z.object({ ping: z.boolean().optional(), messageChunks: z.boolean().optional(), messageDelta: z.literal(1).optional(), promptMessageId: z.literal(1).optional(), relayPromptMessageId: z.literal(1).optional(), sessionCreate: z.literal(1).optional(), workspaceDiff: z.literal(1).optional() }).optional(),
})
export type RelayInfo = z.infer<typeof relayInfoSchema>
/** Largest canonical message body accepted by both relay planning and browser reassembly. */
export const MAX_CANONICAL_MESSAGE_BYTES = 7 * 1024 * 1024

export const messageFingerprintSchema = z.string().length(43).regex(/^[A-Za-z0-9_-]+$/)
/** Remove all browser-local delivery, provenance, and grace metadata without mutating an OpenCode message. */
export const canonicalMessageValue = (value: JsonValue): JsonValue => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value
  const message = value as Record<string, JsonValue>
  const info = message.info
  if (!info || typeof info !== "object" || Array.isArray(info)) return { ...message }
  const { delivery: _delivery, legacyPrompt: _legacyPrompt, acceptedMisses: _acceptedMisses, ...canonicalInfo } = info as Record<string, JsonValue>
  return { ...message, info: canonicalInfo }
}
export const messageInventoryEntrySchema = z.object({ id: z.string().min(1).max(200), fingerprint: messageFingerprintSchema }).strict()
export const messageDeltaScopeSchema = z.object({ kind: z.literal("tail"), limit: z.literal(80) }).strict()
export const messageDeltaManifestSchema = z.object({
  version: z.literal(1),
  scope: messageDeltaScopeSchema,
  manifest: z.array(messageInventoryEntrySchema).max(80).superRefine((entries, context) => {
    if (new Set(entries.map((entry) => entry.id)).size !== entries.length) context.addIssue({ code: "custom", message: "Message ids must be unique" })
  }),
  upserts: z.array(z.string().min(1).max(200)).max(80).superRefine((ids, context) => {
    if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", message: "Upsert ids must be unique" })
  }),
  chunkCount: z.number().int().nonnegative().max(4_096),
  snapshotId: messageFingerprintSchema,
}).strict().superRefine((value, context) => {
  const known = new Set(value.manifest.map((entry) => entry.id))
  if (value.upserts.some((id) => !known.has(id))) context.addIssue({ code: "custom", message: "Upserts must be in manifest" })
})
export type MessageDeltaManifest = z.infer<typeof messageDeltaManifestSchema>

export const messageDeltaFragmentSchema = z.object({
  messageId: z.string().min(1).max(200), fingerprint: messageFingerprintSchema,
  index: z.number().int().nonnegative(), total: z.number().int().positive().max(4_096), bytes: z.string().min(1),
}).strict()
export const messageDeltaChunkSchema = z.object({
  requestId: z.string().min(1), snapshotId: messageFingerprintSchema,
  index: z.number().int().nonnegative().max(4_095), total: z.number().int().positive().max(4_096),
  records: z.array(z.object({ id: z.string().min(1).max(200), fingerprint: messageFingerprintSchema, message: z.unknown() }).strict()).max(80),
  fragments: z.array(messageDeltaFragmentSchema).max(4_096).default([]),
}).strict().superRefine((value, context) => {
  if (value.index >= value.total) context.addIssue({ code: "custom", message: "Chunk index must be below total" })
  if (!value.records.length && !value.fragments.length) context.addIssue({ code: "custom", message: "Chunk must carry a record or fragment" })
})
export type MessageDeltaChunk = z.infer<typeof messageDeltaChunkSchema>

export const questionRequestSchema = z.object({
  id: z.string(),
  sessionID: z.string(),
  targetSessionID: z.string().optional(),
  questions: z.array(
    z.object({
      question: z.string(),
      header: z.string(),
      options: z.array(z.object({ label: z.string(), description: z.string() })),
      multiple: z.boolean().optional(),
      custom: z.boolean().optional(),
    }),
  ),
})
export type QuestionRequest = z.infer<typeof questionRequestSchema>

export const relayMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("relay.hello"), relay: relayInfoSchema, sequence: z.number().int().nonnegative().optional() }),
  z.object({
    type: z.literal("relay.snapshot"),
    relay: relayInfoSchema,
    sessions: z.array(sessionSummarySchema),
    agents: z.array(agentSummarySchema).default([]),
    permissions: z.array(permissionRequestSchema).default([]),
    questions: z.array(questionRequestSchema).default([]),
    sequence: z.number().int().nonnegative().optional(),
  }),
  z.object({ type: z.literal("session.messages.manifest"), requestId: z.string(), manifest: messageDeltaManifestSchema }),
  z.object({ type: z.literal("session.messages.chunk"), chunk: messageDeltaChunkSchema }),
  z.object({
    type: z.literal("relay.event"),
    instanceId: z.string().optional(),
    sequence: z.number().int().nonnegative(),
    event: z.object({ type: z.string(), properties: z.unknown() }),
  }),
  z.object({
    type: z.literal("rpc.result"),
    requestId: z.string(),
    result: z.unknown().optional(),
    error: z.string().optional(),
  }),
  z.object({
    type: z.literal("rpc.chunk"),
    requestId: z.string(),
    index: z.number().int().nonnegative(),
    total: z.number().int().positive().max(4_096),
    done: z.boolean(),
    result: z.unknown().optional(),
    error: z.string().optional(),
  }),
  z.object({
    type: z.literal("device.revoked"),
    deviceId: z.string(),
  }),
])
export type RelayMessage = z.infer<typeof relayMessageSchema>

export const clientCommandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("snapshot.request"),
    requestId: z.string(),
    deviceName: z.string().trim().min(1).max(80).optional(),
  }),
  z.object({
    type: z.literal("session.messages"),
    requestId: z.string(),
    sessionId: z.string(),
    chunked: z.literal(true).optional(),
    sync: z.object({ version: z.literal(1), known: z.array(messageInventoryEntrySchema).max(80).superRefine((entries, context) => {
      if (new Set(entries.map((entry) => entry.id)).size !== entries.length) context.addIssue({ code: "custom", message: "Known message ids must be unique" })
    }) }).strict().optional(),
  }),
  z.object({ type: z.literal("relay.ping"), requestId: z.string(), sentAt: z.number().int().nonnegative() }),
  z.object({
    type: z.literal("session.create"),
    requestId: z.string(),
  }),
  z.object({
    type: z.literal("session.diff"),
    requestId: z.string(),
    sessionId: z.string(),
  }),
  z.object({
    type: z.literal("workspace.diff"),
    requestId: z.string(),
    sessionId: z.string(),
  }),
  z.object({
    type: z.literal("workspace.diff.patch"),
    requestId: z.string(),
    sessionId: z.string(),
    file: z.string().min(1).max(4096),
  }),
  z.object({
    type: z.literal("session.todos"),
    requestId: z.string(),
    sessionId: z.string(),
  }),
  z.object({
    type: z.literal("session.prompt"),
    requestId: z.string(),
    sessionId: z.string(),
    text: z.string().trim().min(1).max(20_000),
    agent: z.string().optional(),
    messageId: z.string().min(1).max(200).optional(),
  }),
  z.object({
    type: z.literal("session.abort"),
    requestId: z.string(),
    sessionId: z.string(),
  }),
  z.object({
    type: z.literal("permission.reply"),
    requestId: z.string(),
    sessionId: z.string(),
    permissionId: z.string(),
    response: z.enum(["once", "always", "reject"]),
    replyDialect: z.enum(["standard", "v2"]).optional(),
  }),
  z.object({
    type: z.literal("question.reply"),
    requestId: z.string(),
    sessionId: z.string(),
    questionId: z.string(),
    answers: z.array(z.array(z.string())),
  }),
  z.object({
    type: z.literal("question.reject"),
    requestId: z.string(),
    sessionId: z.string(),
    questionId: z.string(),
  }),
])
export type ClientCommand = z.infer<typeof clientCommandSchema>

export const brokerMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("broker.ready"), relayConnected: z.boolean() }),
  z.object({ type: z.literal("broker.relay-status"), connected: z.boolean() }),
  z.object({ type: z.literal("broker.error"), message: z.string() }),
  z.object({
    type: z.literal("broker.snapshot"),
    relays: z.array(relayInfoSchema),
    sessions: z.array(sessionSummarySchema),
    agents: z.array(agentSummarySchema),
    permissions: z.array(permissionRequestSchema),
    questions: z.array(questionRequestSchema),
  }),
])
export type BrokerMessage = z.infer<typeof brokerMessageSchema>
