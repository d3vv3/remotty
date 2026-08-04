import { randomUUID } from "node:crypto"
import { arch, hostname, platform } from "node:os"
import type { Plugin } from "@opencode-ai/plugin"
import {
  brokerTransportControlSchema,
  deviceCertificatePayload,
  e2eeFrameSchema,
  sealJsonPayload,
  signCanonicalJson,
  transportProofPayload,
  type AgentSummary,
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
import { readConfig, type DeviceRecord, type RelayConfig } from "./config.js"
import { completionNotification, completionSessionForEvent, shouldNotifySessionCompletion, type CompletionState } from "./notifications.js"
import {
  consumeEnrollment,
  commandChangesState,
  openCommandFrame,
  recordMessageId,
  updateV2ConfigLocked,
  validateEnrollmentFrame,
  workspaceRelayId,
} from "./security.js"
import { includeActiveSession, routeSessionRequests, selectOpenSessions } from "./sessions.js"

type JsonObject = Record<string, unknown>
type SdkResult<T> = { data?: T; error?: unknown }
type RawSdkClient = {
  get: <T>(options: { url: string }) => Promise<SdkResult<T>>
  post: <T>(options: { url: string; body?: unknown }) => Promise<SdkResult<T>>
}

const promptContext = (session: JsonObject) => {
  const model = session.model as JsonObject | undefined
  const providerID = model?.providerID
  const modelID = model?.modelID ?? model?.id
  return {
    ...(typeof session.agent === "string" ? { agent: session.agent } : {}),
    ...(typeof providerID === "string" && typeof modelID === "string"
      ? { model: { providerID, modelID } }
      : {}),
  }
}

const toWebSocketUrl = (brokerUrl: string) => {
  const url = new URL(brokerUrl)
  url.searchParams.set("role", "relay")
  return url
}

const jsonValue = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue

export const remottyPlugin: Plugin = async ({ client, directory }) => {
  const state = await readConfig()
  if (!state || state.version === "legacy") {
    await client.app.log({
      body: {
        service: "remotty",
        level: "warn",
        message: state?.version === "legacy"
          ? `Legacy remotty config found at ${state.path}. Strict E2EE v2 requires a new pairing; run 'remotty pair'.`
          : "remotty is not paired. Run 'remotty pair'.",
      },
    })
    return {}
  }

  const brokerUrl = process.env.REMOTTY_URL ?? state.brokerUrl
  if (!isSecureBrokerUrl(brokerUrl)) {
    await client.app.log({ body: { service: "remotty", level: "error", message: "REMOTTY_URL must use WSS outside loopback." } })
    return {}
  }
  const config: RelayConfig = {
    ...state,
    brokerUrl,
    name: process.env.REMOTTY_NAME ?? state.name,
  }
  const instanceId = randomUUID()
  const instanceStartedAt = Date.now()
  const relayId = workspaceRelayId(config.authorityId, hostname(), directory, instanceId)
  const relay: RelayInfo = {
    id: relayId,
    name: config.name,
    hostname: hostname(),
    platform: platform(),
    arch: arch(),
    workspace: directory,
    instanceId,
    instanceStartedAt,
  }

  let socket: WebSocket | undefined
  let stopped = false
  let sequence = 0
  let reconnectDelay = 1_000
  let activeSessionId: string | undefined
  const visibleSessionIds = new Set<string>()
  let transportReady = false
  const recentReadFrames = new Set<string>()
  const recentReadFrameQueue: string[] = []
  const completionState: CompletionState = { busy: new Set(), notified: new Set() }
  let knownSessions: JsonObject[] = []

  const log = (level: "warn" | "error", message: string, error?: unknown) => client.app.log({
    body: {
      service: "remotty",
      level,
      message,
      ...(error === undefined ? {} : { extra: { error: String(error) } }),
    },
  })

  const sendEncrypted = async (
    payload: unknown,
    recipient: Pick<DeviceRecord, "id" | "encryptionPublicKey">,
    channel: E2eeChannel = "data",
  ) => {
    const target = socket
    if (target?.readyState !== WebSocket.OPEN || !transportReady || channel === "enroll") return
    const frame = await sealJsonPayload(jsonValue(payload), {
      channel,
      sender: relayId,
      recipient: recipient.id,
      messageId: randomUUID(),
      issuedAt: Date.now(),
      senderSigningPrivateKey: config.relaySigningPrivateKey,
      senderEncryptionPrivateKey: config.relayEncryptionPrivateKey,
      recipientEncryptionPublicKey: recipient.encryptionPublicKey,
    })
    if (socket === target && target.readyState === WebSocket.OPEN) target.send(JSON.stringify(frame))
  }

  const sendPayload = async (payload: unknown, device: DeviceRecord, channel: E2eeChannel = "data") => {
    if (device.revokedAt) return
    const latest = await readConfig()
    const recipient = latest?.version === 2
      ? latest.devices.find((candidate) => candidate.id === device.id && !candidate.revokedAt)
      : undefined
    if (recipient) await sendEncrypted(payload, recipient, channel)
  }

  const activeDevices = async () => {
    const current = await readConfig()
    if (current?.version !== 2) throw new Error("Relay v2 configuration is unavailable")
    return current.devices.filter((device) => !device.revokedAt)
  }

  const broadcast = async (payload: unknown, channel: E2eeChannel = "data") => {
    await Promise.all((await activeDevices()).map((device) => sendEncrypted(payload, device, channel)))
  }
  let stateSendQueue = Promise.resolve()
  const sendOrderedState = (create: () => RelayMessage, target?: DeviceRecord) => {
    const operation = stateSendQueue.then(async () => {
      const message = create()
      if (target) await sendPayload(message, target)
      else await broadcast(message)
    })
    stateSendQueue = operation.catch(() => undefined)
    return operation
  }

  const sdkData = async <T>(request: Promise<SdkResult<T>>): Promise<T> => {
    const result = await request
    if (result.error) throw new Error(`OpenCode request failed: ${JSON.stringify(result.error)}`)
    if (result.data === undefined) throw new Error("OpenCode returned no data")
    return result.data
  }

  const sdkCall = async (request: Promise<SdkResult<unknown>>) => {
    const result = await request
    if (result.error) throw new Error(`OpenCode request failed: ${JSON.stringify(result.error)}`)
    return result.data
  }

  const rawClient = (client as unknown as { _client: RawSdkClient })._client

  const snapshot = async (target?: DeviceRecord) => {
    const [listedSessions, statuses, vcs, agents, permissions, questions] = await Promise.all([
      sdkData(client.session.list()) as Promise<Array<JsonObject>>,
      sdkData(client.session.status()) as Promise<Record<string, { type: "idle" | "busy" | "retry" }>>,
      (sdkData(client.vcs.get()) as Promise<{ branch?: string | null }>).catch((): { branch?: string } => ({})),
      (sdkData(client.app.agents()) as Promise<Array<JsonObject>>).catch(() => []),
      sdkData(rawClient.get<PermissionRequest[]>({ url: "/permission" })).catch(() => []),
      sdkData(rawClient.get<QuestionRequest[]>({ url: "/question" })).catch(() => []),
    ])
    const sessions = includeActiveSession(listedSessions, knownSessions, activeSessionId)
    const selected = selectOpenSessions(sessions, statuses, activeSessionId, visibleSessionIds)
    for (const session of selected.sessions) visibleSessionIds.add(String(session.id))
    knownSessions = sessions
    activeSessionId = selected.activeSessionId
    const summaries: SessionSummary[] = selected.sessions.map((session) => {
      const summary = session.summary as JsonObject | undefined
      const time = session.time as JsonObject | undefined
      return {
        id: String(session.id),
        title: String(session.title ?? "Untitled session"),
        directory: String(session.directory ?? directory),
        branch: typeof vcs.branch === "string" ? vcs.branch : undefined,
        agent: typeof session.agent === "string" ? session.agent : undefined,
        status: statuses[String(session.id)]?.type ?? "idle",
        updatedAt: Number(time?.updated ?? time?.created ?? Date.now()),
        additions: Number(summary?.additions ?? 0),
        deletions: Number(summary?.deletions ?? 0),
        files: Number(summary?.files ?? 0),
      }
    })
    const message: RelayMessage = {
      type: "relay.snapshot",
      relay,
      sessions: summaries,
      agents: agents
        .filter((agent) => agent.mode === "primary" || agent.mode === "all")
        .map(
          (agent): AgentSummary => ({
            name: String(agent.name),
            description: typeof agent.description === "string" ? agent.description : undefined,
            mode: agent.mode === "all" ? "all" : "primary",
            color: typeof agent.color === "string" ? agent.color : undefined,
          }),
        ),
      permissions: routeSessionRequests(permissions, sessions),
      questions: routeSessionRequests(questions, sessions),
    }
    await sendOrderedState(() => ({ ...message, sequence: sequence++ }), target)
  }

  const reply = async (device: DeviceRecord, requestId: string, result?: unknown, error?: unknown) => {
    await sendPayload({
      type: "rpc.result",
      requestId,
      ...(error ? { error: error instanceof Error ? error.message : String(error) } : { result }),
    }, device)
  }

  const handleCommand = async (command: ClientCommand, device: DeviceRecord) => {
    try {
      switch (command.type) {
        case "snapshot.request":
          await snapshot(device)
          await reply(device, command.requestId, true)
          break
        case "session.messages":
          await reply(device, command.requestId, await sdkData(client.session.messages({ path: { id: command.sessionId }, query: { limit: 80 } })))
          break
        case "session.diff":
          await reply(device, command.requestId, await sdkData(client.session.diff({ path: { id: command.sessionId } })))
          break
        case "session.todos":
          await reply(device, command.requestId, await sdkData(client.session.todo({ path: { id: command.sessionId } })))
          break
        case "session.prompt": {
          const session = (await sdkData(client.session.get({ path: { id: command.sessionId } }))) as unknown as JsonObject
          const promptRequest = sdkCall(client.session.promptAsync({
            path: { id: command.sessionId },
            body: {
              ...promptContext(session),
              ...(command.agent ? { agent: command.agent } : {}),
              parts: [{ type: "text", text: command.text }],
            },
          }))
          await reply(device, command.requestId, true)
          void promptRequest.catch((error) => client.app.log({
            body: {
              service: "remotty",
              level: "error",
              message: "Remote prompt failed after dispatch",
              extra: { error: String(error), sessionId: command.sessionId },
            },
          }))
          break
        }
        case "session.abort":
          await reply(device, command.requestId, await sdkData(client.session.abort({ path: { id: command.sessionId } })))
          break
        case "permission.reply":
          await reply(device, command.requestId, await sdkData(client.postSessionIdPermissionsPermissionId({
            path: { id: command.sessionId, permissionID: command.permissionId },
            body: { response: command.response },
          })))
          break
        case "question.reply":
          await reply(device, command.requestId, await sdkData(rawClient.post({
            url: `/question/${encodeURIComponent(command.questionId)}/reply`,
            body: { answers: command.answers },
          })))
          break
        case "question.reject":
          await reply(device, command.requestId, await sdkData(rawClient.post({ url: `/question/${encodeURIComponent(command.questionId)}/reject` })))
          break
      }
    } catch (error) {
      await reply(device, command.requestId, undefined, error).catch((replyError) => log("error", "Failed to send encrypted command error", replyError))
    }
  }

  const rememberReadFrame = (messageId: string) => {
    if (recentReadFrames.has(messageId)) throw new Error("Duplicate message id")
    recentReadFrames.add(messageId)
    recentReadFrameQueue.push(messageId)
    if (recentReadFrameQueue.length > 1_024) recentReadFrames.delete(recentReadFrameQueue.shift()!)
  }

  const handleEnrollment = async (frame: ReturnType<typeof e2eeFrameSchema.parse>) => {
    const enrollmentConfig = await readConfig()
    if (enrollmentConfig?.version !== 2) throw new Error("Relay v2 configuration is unavailable")
    const enrollment = await validateEnrollmentFrame(frame, enrollmentConfig)
    let accepted: ReturnType<typeof consumeEnrollment> | undefined
    let current: RelayConfig
    try {
      current = await updateV2ConfigLocked((latest) => {
        accepted = consumeEnrollment(latest, enrollment)
        return accepted.config
      })
    } catch (error) {
      await sendEncrypted({
        type: "enrollment.rejected",
        deviceId: enrollment.device.id,
        message: error instanceof Error ? error.message : "Enrollment failed",
      }, enrollment.device)
      throw error
    }
    const device = current.devices.find((candidate) => candidate.id === enrollment.device.id)
    if (!accepted || !device || device.revokedAt) throw new Error("Enrolled device is unavailable")
    await sendPayload({
      type: "enrollment.accepted",
      deviceId: device.id,
      relayId,
      deviceCertificate: await signCanonicalJson(
        deviceCertificatePayload(device.id, config.roomToken),
        config.relaySigningPrivateKey,
      ),
    }, device)
    await snapshot(device)
  }

  const handleFrame = async (frame: ReturnType<typeof e2eeFrameSchema.parse>) => {
    if (frame.channel === "enroll") {
      await handleEnrollment(frame)
      return
    }
    if (frame.channel !== "data" || frame.recipient !== relayId) throw new Error("Rejected non-command relay frame")
    const latest = await readConfig()
    if (latest?.version !== 2) throw new Error("Relay v2 configuration is unavailable")
    const opened = await openCommandFrame(frame, latest, relayId)
    let device: DeviceRecord | undefined
    try {
      if (commandChangesState(opened.command)) {
        const persisted = await updateV2ConfigLocked((current) =>
          recordMessageId(current, opened.device.id, frame.messageId, frame.issuedAt),
        )
        device = persisted.devices.find((candidate) => candidate.id === opened.device.id && !candidate.revokedAt)
      } else {
        if (opened.device.recentMessages.some((message) => message.id === frame.messageId)) throw new Error("Duplicate message id")
        rememberReadFrame(frame.messageId)
        device = opened.device
      }
      if (!device) throw new Error("Device is not active")
    } catch (error) {
      await reply(opened.device, opened.command.requestId, undefined, error)
      return
    }
    await handleCommand(opened.command, device)
  }

  const connect = () => {
    if (stopped) return
    const connection = new WebSocket(toWebSocketUrl(config.brokerUrl), ["remotty", config.roomToken])
    let helloStarted = false
    socket = connection
    connection.addEventListener("open", () => {
      if (socket !== connection) {
        connection.close(1000, "Superseded connection")
        return
      }
      reconnectDelay = 1_000
      transportReady = false
    })
    connection.addEventListener("message", (message) => {
      if (socket !== connection) return
      let decoded: unknown
      try {
        decoded = JSON.parse(String(message.data))
      } catch (error) {
        void log("warn", "Rejected invalid broker JSON", error)
        return
      }
      const control = brokerTransportControlSchema.safeParse(decoded)
      if (control.success) {
        if (control.data.type === "broker.challenge" && !helloStarted) {
          helloStarted = true
          const challenge = control.data.nonce
          void (async () => {
            const signature = await signCanonicalJson(
              transportProofPayload("relay", relayId, config.roomToken, challenge),
              config.relaySigningPrivateKey,
            )
            if (socket !== connection || connection.readyState !== WebSocket.OPEN) return
            connection.send(JSON.stringify({
              type: "transport.hello",
              version: 2,
              role: "relay",
              relayId,
              publicKey: config.relaySigningPublicKey,
              signature,
            }))
            transportReady = true
            await sendOrderedState(() => ({ type: "relay.hello", relay, sequence: sequence++ }))
            await snapshot()
          })().catch((error) => log("error", "Failed to send initial encrypted relay state", error))
        }
        if (control.data.type === "broker.error") void log("warn", `Broker rejected relay message: ${control.data.code}: ${control.data.message}`)
        return
      }
      const frame = e2eeFrameSchema.safeParse(decoded)
      if (!frame.success) {
        void log("warn", "Rejected invalid encrypted relay frame", frame.error)
        return
      }
      void handleFrame(frame.data).catch((error) => log("warn", "Rejected encrypted relay frame", error))
    })
    connection.addEventListener("close", () => {
      if (stopped || socket !== connection) return
      transportReady = false
      setTimeout(connect, reconnectDelay)
      reconnectDelay = Math.min(reconnectDelay * 2, 30_000)
    })
  }

  connect()

  const sendPushForEvent = async (eventType: string, properties: JsonObject) => {
    const completedSessionId = completionSessionForEvent(eventType, properties, completionState)
    if (completedSessionId) {
      const session = await (sdkData(client.session.get({ path: { id: completedSessionId } })) as Promise<JsonObject>)
        .catch(() => undefined)
      if (!shouldNotifySessionCompletion(session)) return
      await broadcast(completionNotification(
        relayId,
        completedSessionId,
        typeof session?.title === "string" ? session.title : undefined,
      ), "push")
    } else if (["permission.updated", "permission.asked"].includes(eventType)) {
      const permissionId = String(properties.id ?? properties.requestID ?? "")
      const sessionId = String(properties.sessionID ?? "")
      if (!permissionId || !sessionId) return
      const patterns = Array.isArray(properties.patterns) ? properties.patterns.map(String) : []
      await broadcast({
        type: "notification.show",
        title: "Permission required",
        body: patterns[0] ?? String(properties.permission ?? "OpenCode is waiting for approval"),
        tag: `${relayId}:permission-${permissionId}`,
        actions: [
          { action: "reject", title: "Reject" },
          { action: "once", title: "Allow once" },
          { action: "always", title: "Always allow" },
        ],
        data: {
          sessionId,
          permissionId,
          workspaceRelayId: relayId,
          ...(typeof properties.targetSessionID === "string" ? { targetSessionId: properties.targetSessionID } : {}),
        },
      }, "push")
    } else if (eventType === "permission.replied") {
      const permissionId = String(properties.requestID ?? properties.permissionID ?? "")
      const sessionId = String(properties.sessionID ?? "")
      if (permissionId) await broadcast({
        type: "notification.close",
        tag: `${relayId}:permission-${permissionId}`,
        data: { sessionId, permissionId, workspaceRelayId: relayId },
      }, "push")
    } else if (eventType === "question.asked") {
      const questionId = String(properties.id ?? properties.requestID ?? "")
      const sessionId = String(properties.sessionID ?? "")
      if (!questionId || !sessionId) return
      const questions = Array.isArray(properties.questions) ? properties.questions : []
      const first = questions[0] as JsonObject | undefined
      await broadcast({
        type: "notification.show",
        title: "OpenCode has a question",
        body: typeof first?.question === "string" ? first.question : "Open the app to answer",
        tag: `${relayId}:question-${questionId}`,
        actions: [],
        openApp: true,
        data: { sessionId, questionId, workspaceRelayId: relayId },
      }, "push")
    } else if (["question.replied", "question.rejected"].includes(eventType)) {
      const questionId = String(properties.requestID ?? properties.questionID ?? "")
      const sessionId = String(properties.sessionID ?? "")
      if (questionId) await broadcast({
        type: "notification.close",
        tag: `${relayId}:question-${questionId}`,
        data: { sessionId, questionId, workspaceRelayId: relayId },
      }, "push")
    }
  }

  return {
    event: async ({ event }) => {
      const eventType = String(event.type)
      const properties = (event.properties ?? {}) as JsonObject
      const info = properties.info as JsonObject | undefined
      if (["session.created", "session.updated"].includes(eventType) && info?.id) {
        knownSessions = [...knownSessions.filter((session) => session.id !== info.id), info]
      } else if (eventType === "session.deleted" && info?.id) {
        knownSessions = knownSessions.filter((session) => session.id !== info.id)
        visibleSessionIds.delete(String(info.id))
      }
      const routedProperties = ["permission.updated", "permission.asked", "question.asked"].includes(eventType) &&
        typeof properties.sessionID === "string"
        ? routeSessionRequests([properties as JsonObject & { sessionID: string }], knownSessions)[0] ?? properties
        : properties
      await sendOrderedState(() => ({
          type: "relay.event",
          sequence: sequence++,
          instanceId,
          event: { type: eventType, properties: routedProperties },
        }))
      await sendPushForEvent(eventType, routedProperties)
      if (eventType === "tui.session.select") activeSessionId = String(properties.sessionID)
      if (eventType === "session.created") {
        const info = properties.info as JsonObject | undefined
        if (info?.id) activeSessionId = String(info.id)
      }
      if (eventType === "session.deleted" && properties.info && (properties.info as JsonObject).id === activeSessionId) {
        activeSessionId = undefined
      }
      if (["tui.session.select", "session.created", "session.updated", "session.deleted", "session.status", "session.idle", "session.error"].includes(eventType)) {
        await snapshot()
      }
    },
    dispose: async () => {
      stopped = true
      socket?.close(1000, "OpenCode stopped")
    },
  }
}

export default remottyPlugin
