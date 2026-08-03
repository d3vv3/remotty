import { z } from "zod"

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
})
export type RelayInfo = z.infer<typeof relayInfoSchema>

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
])
export type RelayMessage = z.infer<typeof relayMessageSchema>

export const clientCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("snapshot.request"), requestId: z.string() }),
  z.object({
    type: z.literal("session.messages"),
    requestId: z.string(),
    sessionId: z.string(),
  }),
  z.object({
    type: z.literal("session.diff"),
    requestId: z.string(),
    sessionId: z.string(),
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
