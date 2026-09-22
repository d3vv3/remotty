import { randomUUID } from "node:crypto"
import { arch, hostname, platform } from "node:os"
import type { FormInfo, OpenCodeClient, OpenCodeEvent, SessionInfo } from "@opencode/client"
import {
  brokerTransportControlSchema,
  deviceCertificatePayload,
  e2eeFrameSchema,
  sealJsonPayload,
  signCanonicalJson,
  transportProofPayload,
  type AgentTheme,
  type ClientCommand,
  type E2eeChannel,
  type JsonValue,
  type PermissionRequest,
  type QuestionRequest,
  type RelayInfo,
  type RelayMessage,
  type SessionSummary,
  isSecureBrokerUrl,
} from "@remotty/protocol"
import { selectableAgentSummaries } from "./agents.js"
import { workspaceGitDiff, workspaceGitPatch } from "./gitChanges.js"
import { messageDeltaPlan, messagePlan } from "./messageSync.js"
import { openCodeMessageId } from "./messageId.js"
import { completionNotification, completionSessionForEvent, questionNotification, shouldNotifySessionCompletion, type CompletionState } from "./notifications.js"
import { normalizePermissionRequest, normalizePermissionRequests, permissionNotification, permissionReplyId } from "./permissions.js"
import { PerRecipientQueue } from "./sendQueue.js"
import { includeActiveSession, routeSessionRequests, selectOpenSessions, selectSubagents } from "./sessions.js"
import {
  consumeEnrollment,
  commandChangesState,
  DeviceRevokedError,
  openCommandFrame,
  recordMessageId,
  updateV2ConfigLocked,
  validateEnrollmentFrame,
  workspaceRelayId,
} from "./security.js"
import { readConfig, type DeviceRecord, type RelayConfig } from "./config.js"

type JsonObject = Record<string, unknown>
const SESSION_LIST_LIMIT = 1_000

export type RelayRuntimeOptions = {
  client: OpenCodeClient
  directory: string
  localDirectory: boolean
  selectedSessionId: () => string | undefined
  agentTheme: () => AgentTheme | undefined
  subscribe: (handler: (event: OpenCodeEvent) => void) => () => void
  log?: (level: "warn" | "error", message: string, error?: unknown) => void
}

const toWebSocketUrl = (brokerUrl: string) => {
  const url = new URL(brokerUrl)
  url.searchParams.set("role", "relay")
  return url
}

const jsonValue = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue
const object = (value: unknown): JsonObject => value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {}

/** Serializes acquisition and publication so a later snapshot cannot overtake an earlier one. */
export const createSnapshotQueue = () => {
  let queue = Promise.resolve()
  return <T>(operation: () => Promise<T>) => {
    const result = queue.then(operation)
    queue = result.then(() => undefined, () => undefined)
    return result
  }
}

export const isRemotelyAnswerableForm = (value: unknown) => {
  const form = object(value)
  return Array.isArray(form.fields) && !form.fields.some((field) => object(field).type === "external")
}

export type NormalizedRelayEvent = { type: string; properties: JsonObject }

const sessionIdFrom = (properties: JsonObject) => {
  const info = object(properties.info)
  const part = object(properties.part)
  return typeof properties.sessionID === "string" ? properties.sessionID
    : typeof info.sessionID === "string" ? info.sessionID
      : typeof part.sessionID === "string" ? part.sessionID
        : undefined
}

/** Events without a location are global and remain visible to the active relay. */
export const isEventForDirectory = (event: unknown, directory: string) => {
  const location = object(object(event).location)
  return typeof location.directory !== "string" || location.directory === directory
}

/** Preserves the relay's established PWA event contract for OpenCode v2 events. */
export const normalizeRelayEvent = (event: Pick<OpenCodeEvent, "type" | "data">): NormalizedRelayEvent | undefined => {
  const type: string = event.type
  const properties = object(event.data)
  const sessionID = sessionIdFrom(properties)
  if (type === "form.created") {
    const form = object(properties.form)
    return isRemotelyAnswerableForm(form) ? { type: "question.asked", properties: questionFromForm(form as FormInfo) } : undefined
  }
  if (type === "form.replied") return { type: "question.replied", properties: { requestID: properties.requestID ?? properties.id, ...(sessionID ? { sessionID } : {}) } }
  if (type === "form.cancelled") return { type: "question.rejected", properties: { requestID: properties.requestID ?? properties.id, ...(sessionID ? { sessionID } : {}) } }
  if (type === "session.execution.started") return { type: "session.status", properties: { ...(sessionID ? { sessionID } : {}), status: { type: "busy" } } }
  if (type === "session.execution.succeeded" || type === "session.execution.interrupted") return { type: "session.idle", properties: sessionID ? { sessionID } : {} }
  if (type === "session.execution.failed") return { type: "session.error", properties: { ...(sessionID ? { sessionID } : {}), error: properties.error } }
  if (type.startsWith("session.text.") || type.startsWith("session.reasoning.") || type.startsWith("session.tool.") || type.startsWith("session.step.") || type === "session.message.content.updated") {
    return { type: "message.updated", properties: sessionID ? { sessionID } : {} }
  }
  return { type, properties }
}

/** Maps v2 session forms into the established encrypted question payload. */
export const questionFromForm = (form: FormInfo): QuestionRequest => {
  if (!isRemotelyAnswerableForm(form)) throw new Error("OpenCode forms with external fields cannot be completed remotely")
  return {
    id: form.id,
    sessionID: form.sessionID,
    questions: form.fields.map((field) => {
    const options = field.type === "multiselect" || (field.type === "string" && field.options)
      ? field.options!.map((option) => ({ label: option.value, description: option.description ?? option.label }))
      : field.type === "boolean"
        ? [{ label: "true", description: "True" }, { label: "false", description: "False" }]
        : []
    return {
      question: field.description ?? field.title ?? field.key,
      header: field.title ?? form.title,
      options,
      ...(field.type === "multiselect" ? { multiple: true } : {}),
      ...(field.type === "string" || field.type === "number" || field.type === "integer" ? { custom: true } : {}),
    }
    }),
  }
}

/** OpenCode v2 removed todos. An empty result clears the PWA's previous cache. */
export const v2Todos = (): [] => []

const formAnswer = (form: FormInfo, answers: string[][]) => {
  if (answers.length !== form.fields.length) throw new Error("Form answer count does not match the requested fields")
  return Object.fromEntries(form.fields.map((field, index) => {
    const answer = answers[index] ?? []
    if (!answer.length && "required" in field && field.required) throw new Error(`Missing answer for ${field.key}`)
    if (field.type === "multiselect") return [field.key, answer]
    const value = answer[0] ?? ""
    if (field.type === "boolean") {
      if (value !== "true" && value !== "false") throw new Error(`Invalid boolean answer for ${field.key}`)
      return [field.key, value === "true"]
    }
    if (field.type === "number" || field.type === "integer") {
      const parsed = Number(value)
      if (!Number.isFinite(parsed) || (field.type === "integer" && !Number.isInteger(parsed))) throw new Error(`Invalid numeric answer for ${field.key}`)
      return [field.key, parsed]
    }
    if (field.type === "external") throw new Error("External OpenCode form fields cannot be completed remotely")
    return [field.key, value]
  }))
}

export async function startRelay(options: RelayRuntimeOptions): Promise<() => Promise<void>> {
  const { client, directory } = options
  const state = await readConfig()
  const log = options.log ?? ((level, message, error) => console[level]("[remotty]", message, error ?? ""))
  if (!state || state.version === "legacy") {
    log("warn", state?.version === "legacy"
      ? `Legacy remotty config found at ${state.path}. Strict E2EE v2 requires a new pairing; run 'remotty pair'.`
      : "remotty is not paired. Run 'remotty pair'.")
    return async () => undefined
  }
  const brokerUrl = process.env.REMOTTY_URL ?? state.brokerUrl
  if (!isSecureBrokerUrl(brokerUrl)) {
    log("error", "REMOTTY_URL must use WSS outside loopback.")
    return async () => undefined
  }
  const config: RelayConfig = { ...state, brokerUrl, name: process.env.REMOTTY_NAME ?? state.name }
  const instanceId = randomUUID()
  const instanceStartedAt = Date.now()
  const relayId = workspaceRelayId(config.authorityId, hostname(), directory, instanceId)
  const workspaceId = workspaceRelayId(config.authorityId, hostname(), directory, "workspace")
  const relay: RelayInfo = {
    id: relayId, name: config.name, hostname: hostname(), platform: platform(), arch: arch(), workspace: directory,
    instanceId, instanceStartedAt, workspaceId,
    capabilities: { ping: true, messageChunks: true, messageDelta: 1, relayPromptMessageId: 1, sessionCreate: 1, workspaceDiff: 1, subagents: 1 },
  }
  let socket: WebSocket | undefined
  let generation = 1
  let sequence = 0
  let reconnectDelay = 1_000
  let transportReady = false
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let knownSessions: JsonObject[] = []
  const completionState: CompletionState = { busy: new Set(), notified: new Set() }
  const readFrames = new Set<string>()
  const readFrameQueue: string[] = []
  const notifiedRevocations = new Set<string>()
  let controlQueue = Promise.resolve()
  let stateQueue = Promise.resolve()
  const queueSnapshot = createSnapshotQueue()
  const bulkQueues = new PerRecipientQueue()
  const isCurrent = (current = generation) => current === generation

  const sendEncrypted = async (payload: unknown, recipient: Pick<DeviceRecord, "id" | "encryptionPublicKey">, channel: E2eeChannel = "data") => {
    const target = socket
    if (!target || target.readyState !== WebSocket.OPEN || !transportReady || channel === "enroll") return
    const frame = await sealJsonPayload(jsonValue(payload), {
      channel, sender: relayId, recipient: recipient.id, messageId: randomUUID(), issuedAt: Date.now(),
      senderSigningPrivateKey: config.relaySigningPrivateKey, senderEncryptionPrivateKey: config.relayEncryptionPrivateKey,
      recipientEncryptionPublicKey: recipient.encryptionPublicKey,
    })
    if (isCurrent() && socket === target && target.readyState === WebSocket.OPEN) target.send(JSON.stringify(frame))
  }
  const activeDevices = async () => {
    const latest = await readConfig()
    if (latest?.version !== 2) throw new Error("Relay v2 configuration is unavailable")
    return latest.devices.filter((device) => !device.revokedAt)
  }
  const sendPayload = async (payload: unknown, device: DeviceRecord, channel: E2eeChannel = "data") => {
    if (device.revokedAt || !isCurrent()) return
    const latest = await readConfig()
    const recipient = latest?.version === 2 ? latest.devices.find((candidate) => candidate.id === device.id && !candidate.revokedAt) : undefined
    if (recipient) await sendEncrypted(payload, recipient, channel)
  }
  const broadcast = async (payload: unknown, channel: E2eeChannel = "data") => {
    await Promise.all((await activeDevices()).map((device) => sendEncrypted(payload, device, channel)))
  }
  const enqueuePayload = (payload: unknown, device: DeviceRecord, priority: "control" | "bulk" = "control") => {
    if (priority === "bulk") return bulkQueues.enqueue(device.id, () => sendPayload(payload, device))
    const operation = controlQueue.then(() => sendPayload(payload, device))
    controlQueue = operation.catch(() => undefined)
    return operation
  }
  const sendOrderedState = (create: () => RelayMessage, target?: DeviceRecord) => {
    const current = generation
    const operation = stateQueue.then(async () => {
      if (!isCurrent(current)) return
      const message = create()
      if (target) await sendPayload(message, target)
      else await broadcast(message)
    })
    stateQueue = operation.catch(() => undefined)
    return operation
  }
  const listSessions = async () => {
    const listed = await client.session.list({ directory, limit: SESSION_LIST_LIMIT })
    if (listed.data.length >= SESSION_LIST_LIMIT) log("warn", `Session list reached the ${SESSION_LIST_LIMIT}-session relay limit`)
    return listed.data
  }
  const snapshot = (target?: DeviceRecord) => queueSnapshot(async () => {
    const [sessions, active, vcs, agents, permissionResult, formResult] = await Promise.all([
      listSessions(), client.session.active(), client.vcs.get({ location: { directory } }).then((result) => result.data).catch(() => undefined),
      client.agent.list({ location: { directory } }).then((result) => result.data).catch(() => []),
      client.permission.request.list({ location: { directory } }).catch(() => ({ data: [] })),
      client.form.list({ location: { directory } }).catch(() => ({ data: [] })),
    ])
    knownSessions = sessions.map((session) => ({ ...session, directory: session.location.directory }))
    const selected = selectOpenSessions(includeActiveSession(knownSessions, knownSessions, options.selectedSessionId()), options.selectedSessionId())
    const statuses = active as Record<string, { type: "idle" | "running" }>
    const summaryFor = (session: JsonObject): SessionSummary => {
      const time = object(session.time)
      return {
        id: String(session.id), title: typeof session.title === "string" ? session.title : "Untitled session",
        directory: typeof session.directory === "string" ? session.directory : directory,
        branch: vcs?.branch.current, agent: typeof session.agent === "string" ? session.agent : undefined,
        status: statuses[String(session.id)]?.type === "running" ? "busy" : "idle",
        updatedAt: Number(time.updated ?? time.created ?? Date.now()), additions: 0, deletions: 0, files: 0,
      }
    }
    const permissions = normalizePermissionRequests(permissionResult.data, () => log("warn", "Unsupported OpenCode permission payload"))
    const forms = formResult.data.filter(isRemotelyAnswerableForm).map(questionFromForm)
    const theme = options.agentTheme()
    await sendOrderedState(() => ({
      type: "relay.snapshot", relay, sessions: selected.sessions.map(summaryFor),
      subagents: selectSubagents(selected.sessions, knownSessions).map((session) => ({ ...summaryFor(session), parentSessionId: String(session.parentSessionId), rootSessionId: String(session.rootSessionId) })),
      agents: selectableAgentSummaries(agents), ...(theme ? { agentTheme: theme } : {}),
      permissions: routeSessionRequests(permissions, knownSessions), questions: routeSessionRequests(forms, knownSessions), sequence: sequence++,
    }), target)
  })
  const reply = (device: DeviceRecord, requestId: string, result?: unknown, error?: unknown) => sendPayload({
    type: "rpc.result", requestId, ...(error ? { error: error instanceof Error ? error.message : String(error) } : { result }),
  }, device)
  const formFor = async (sessionID: string, formID: string) => {
    const forms = await client.session.form.list({ sessionID })
    const form = forms.find((candidate) => candidate.id === formID)
    if (!form) throw new Error("OpenCode form is no longer pending")
    if (!isRemotelyAnswerableForm(form)) throw new Error("OpenCode forms with external fields cannot be completed remotely")
    return form
  }
  const assertScopedSession = async (sessionID: string) => {
    const session = await client.session.get({ sessionID })
    if (session.location.directory !== directory) throw new Error("Session is outside the active OpenCode location")
    return session
  }
  const handleCommand = async (command: ClientCommand, device: DeviceRecord) => {
    try {
      switch (command.type) {
        case "snapshot.request": await snapshot(device); await reply(device, command.requestId, true); break
        case "relay.ping": await reply(device, command.requestId, { sentAt: command.sentAt }); break
        case "session.messages": {
          await assertScopedSession(command.sessionId)
          const messages = (await client.message.list({ sessionID: command.sessionId, limit: 80 })).data as unknown as JsonObject[]
          if (command.sync) {
            const plan = await messageDeltaPlan(messages, command.sync.known)
            await enqueuePayload({ type: "session.messages.manifest", requestId: command.requestId, manifest: plan.manifest }, device)
            for (const chunk of plan.chunks) await enqueuePayload({ type: "session.messages.chunk", chunk: { ...chunk, requestId: command.requestId } }, device, "bulk")
          } else if (!command.chunked) await reply(device, command.requestId, messages)
          else {
            const plan = messagePlan(messages)
            await reply(device, command.requestId, { manifest: true, ids: plan.ids, total: plan.chunks.length })
            for (const [index, chunk] of plan.chunks.entries()) await enqueuePayload({ type: "rpc.chunk", requestId: command.requestId, index, total: plan.chunks.length, done: index === plan.chunks.length - 1, result: chunk }, device, "bulk")
          }
          break
        }
        case "session.create": {
          const created = await client.session.create({ location: { directory } })
          await snapshot(); await reply(device, command.requestId, { sessionId: created.id }); break
        }
        case "session.diff": await assertScopedSession(command.sessionId); await reply(device, command.requestId, await client.session.diff({ sessionID: command.sessionId })); break
        case "workspace.diff":
          await assertScopedSession(command.sessionId)
          if (!options.localDirectory) throw new Error("Workspace Git operations require a verified local OpenCode location")
          await reply(device, command.requestId, await workspaceGitDiff(directory)); break
        case "workspace.diff.patch":
          await assertScopedSession(command.sessionId)
          if (!options.localDirectory) throw new Error("Workspace Git operations require a verified local OpenCode location")
          await reply(device, command.requestId, await workspaceGitPatch(directory, command.file)); break
        case "session.todos": await reply(device, command.requestId, v2Todos()); break
        case "session.prompt": {
          await assertScopedSession(command.sessionId)
          const messageId = openCodeMessageId()
          await client.session.prompt({ sessionID: command.sessionId, id: messageId, text: command.text, ...(command.agent ? { agents: [{ name: command.agent }] } : {}) })
          await reply(device, command.requestId, { messageId }); break
        }
        case "session.abort": await assertScopedSession(command.sessionId); await reply(device, command.requestId, await client.session.interrupt({ sessionID: command.sessionId })); break
        case "permission.reply": await assertScopedSession(command.sessionId); await client.permission.reply({ sessionID: command.sessionId, requestID: command.permissionId, decision: command.response }); await reply(device, command.requestId, undefined); break
        case "question.reply": {
          await assertScopedSession(command.sessionId)
          const form = await formFor(command.sessionId, command.questionId)
          await client.session.form.reply({ sessionID: command.sessionId, formID: command.questionId, answer: formAnswer(form, command.answers) })
          await reply(device, command.requestId, undefined); break
        }
        case "question.reject": await assertScopedSession(command.sessionId); await client.session.form.cancel({ sessionID: command.sessionId, formID: command.questionId }); await reply(device, command.requestId, undefined); break
      }
    } catch (error) {
      await reply(device, command.requestId, undefined, error).catch((replyError) => log("error", "Failed to send encrypted command error", replyError))
    }
  }
  const rememberReadFrame = (messageId: string) => {
    if (readFrames.has(messageId)) throw new Error("Duplicate message id")
    readFrames.add(messageId); readFrameQueue.push(messageId)
    if (readFrameQueue.length > 1_024) readFrames.delete(readFrameQueue.shift()!)
  }
  const handleEnrollment = async (frame: ReturnType<typeof e2eeFrameSchema.parse>) => {
    const enrollmentConfig = await readConfig()
    if (enrollmentConfig?.version !== 2) throw new Error("Relay v2 configuration is unavailable")
    const enrollment = await validateEnrollmentFrame(frame, enrollmentConfig)
    let accepted: ReturnType<typeof consumeEnrollment> | undefined
    const current = await updateV2ConfigLocked((latest) => {
      accepted = consumeEnrollment(latest, enrollment)
      return accepted.config
    })
    const device = current.devices.find((candidate) => candidate.id === enrollment.device.id && !candidate.revokedAt)
    if (!accepted || !device) throw new Error("Enrolled device is unavailable")
    await sendPayload({ type: "enrollment.accepted", deviceId: device.id, relayId, deviceCertificate: await signCanonicalJson(deviceCertificatePayload(device.id, config.roomToken), config.relaySigningPrivateKey) }, device)
    await snapshot(device)
  }
  const handleFrame = async (frame: ReturnType<typeof e2eeFrameSchema.parse>) => {
    if (frame.channel === "enroll") return handleEnrollment(frame)
    if (frame.channel !== "data" || frame.recipient !== relayId) throw new Error("Rejected non-command relay frame")
    const latest = await readConfig()
    if (latest?.version !== 2) throw new Error("Relay v2 configuration is unavailable")
    let opened: Awaited<ReturnType<typeof openCommandFrame>>
    try {
      opened = await openCommandFrame(frame, latest, relayId)
    } catch (error) {
      if (!(error instanceof DeviceRevokedError)) throw error
      await sendEncrypted({ type: "device.revoked", deviceId: error.device.id }, error.device)
      await updateV2ConfigLocked((current) => ({ ...current, devices: current.devices.filter((candidate) => candidate.id !== error.device.id || !candidate.revokedAt) }))
      return
    }
    if (commandChangesState(opened.command)) {
      const persisted = await updateV2ConfigLocked((current) => recordMessageId(current, opened.device.id, frame.messageId, frame.issuedAt))
      const device = persisted.devices.find((candidate) => candidate.id === opened.device.id && !candidate.revokedAt)
      if (!device) throw new Error("Device is not active")
      opened = { ...opened, device }
    } else rememberReadFrame(frame.messageId)
    await handleCommand(opened.command, opened.device)
  }
  const connect = () => {
    const current = generation
    if (!isCurrent(current)) return
    const connection = new WebSocket(toWebSocketUrl(config.brokerUrl), ["remotty", config.roomToken])
    let helloStarted = false
    socket = connection
    connection.addEventListener("message", (message) => {
      if (!isCurrent(current) || socket !== connection) return
      let decoded: unknown
      try { decoded = JSON.parse(String(message.data)) } catch (error) { log("warn", "Rejected invalid broker JSON", error); return }
      const control = brokerTransportControlSchema.safeParse(decoded)
      if (control.success) {
        if (control.data.type === "broker.challenge" && !helloStarted) {
          helloStarted = true
          void signCanonicalJson(transportProofPayload("relay", relayId, config.roomToken, control.data.nonce), config.relaySigningPrivateKey).then((signature) => {
            if (isCurrent(current) && socket === connection && connection.readyState === WebSocket.OPEN) connection.send(JSON.stringify({ type: "transport.hello", version: 2, role: "relay", relayId, publicKey: config.relaySigningPublicKey, signature }))
          }).catch((error) => log("error", "Failed to authenticate relay", error))
        }
        if (control.data.type === "broker.ready") {
          transportReady = true; reconnectDelay = 1_000
          void sendOrderedState(() => ({ type: "relay.hello", relay, sequence: sequence++ })).then(() => snapshot()).catch((error) => log("error", "Failed to send initial relay state", error))
        }
        if (control.data.type === "broker.error") log("warn", `Broker rejected relay message: ${control.data.code}: ${control.data.message}`)
        return
      }
      const frame = e2eeFrameSchema.safeParse(decoded)
      if (!frame.success) { log("warn", "Rejected invalid encrypted relay frame", frame.error); return }
      void handleFrame(frame.data).catch((error) => log("warn", "Rejected encrypted relay frame", error))
    })
    connection.addEventListener("close", () => {
      if (!isCurrent(current) || socket !== connection) return
      transportReady = false
      reconnectTimer = setTimeout(connect, reconnectDelay)
      reconnectDelay = Math.min(reconnectDelay * 2, 30_000)
    })
  }
  const event = async (event: OpenCodeEvent) => {
    if (!isCurrent()) return
    if (!isEventForDirectory(event, directory)) return
    const normalized = normalizeRelayEvent(event)
    const rawType = event.type
    if (rawType === "session.created" || rawType === "session.deleted" || rawType === "form.created" || rawType === "form.replied" || rawType === "form.cancelled" || rawType === "permission.asked" || rawType === "permission.replied" || ["session.status", "session.idle", "session.error"].includes(normalized?.type ?? "")) {
      await snapshot()
    }
    if (!normalized) return
    const { type: eventType, properties } = normalized
    const permission = eventType === "permission.asked" ? normalizePermissionRequest(properties) : undefined
    const routed = permission ? routeSessionRequests([permission], knownSessions)[0]! : properties
    await sendOrderedState(() => ({ type: "relay.event", sequence: sequence++, instanceId, event: { type: eventType, properties: routed } }))
    const completed = completionSessionForEvent(eventType, properties, completionState)
    if (completed) {
      const session = await client.session.get({ sessionID: completed }).catch(() => undefined)
      if (shouldNotifySessionCompletion(session as JsonObject | undefined)) await broadcast(completionNotification(relayId, completed, session?.title, workspaceId), "push")
    } else if (permission) await broadcast(permissionNotification(relayId, workspaceId, routed as PermissionRequest), "push")
    else if (eventType === "permission.replied") {
      const permissionId = permissionReplyId(properties)
      if (permissionId) await broadcast({ type: "notification.close", tag: `${relayId}:permission-${permissionId}`, data: { sessionId: String(properties.sessionID ?? ""), permissionId, workspaceRelayId: relayId } }, "push")
    } else if (eventType === "question.asked") {
      const questionId = typeof properties.id === "string" ? properties.id : ""
      const sessionId = typeof properties.sessionID === "string" ? properties.sessionID : ""
      const firstQuestion = Array.isArray(properties.questions) ? object(properties.questions[0]) : {}
      if (questionId && sessionId) await broadcast(questionNotification(relayId, workspaceId, questionId, sessionId, typeof firstQuestion.header === "string" ? firstQuestion.header : undefined), "push")
    } else if (eventType === "question.replied" || eventType === "question.rejected") {
      const questionId = typeof properties.requestID === "string" ? properties.requestID : ""
      if (questionId) await broadcast({ type: "notification.close", tag: `${relayId}:question-${questionId}`, data: { sessionId: String(properties.sessionID ?? ""), questionId, workspaceRelayId: relayId } }, "push")
    }
  }
  // Register before any connection can trigger the authoritative snapshot.
  const unsubscribe = options.subscribe((next) => { void event(next).catch((error) => log("warn", "Failed to publish OpenCode event", error)) })
  connect()
  const revocationTimer = setInterval(() => {
    void (async () => {
      if (!transportReady || !isCurrent()) return
      const latest = await readConfig()
      if (latest?.version !== 2) return
      for (const device of latest.devices) {
        if (!device.revokedAt || notifiedRevocations.has(device.id)) continue
        notifiedRevocations.add(device.id)
        await sendEncrypted({ type: "device.revoked", deviceId: device.id }, device)
      }
    })().catch(() => undefined)
  }, 5_000)
  return async () => {
    if (!isCurrent()) return
    generation += 1
    transportReady = false
    unsubscribe()
    clearInterval(revocationTimer)
    if (reconnectTimer) clearTimeout(reconnectTimer)
    socket?.close(1000, "OpenCode stopped")
    socket = undefined
  }
}
