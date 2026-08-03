import { createHash } from "node:crypto"
import { arch, hostname, platform } from "node:os"
import type { Plugin } from "@opencode-ai/plugin"
import {
  clientCommandSchema,
  type AgentSummary,
  type ClientCommand,
  type PermissionRequest,
  type QuestionRequest,
  type RelayInfo,
  type RelayMessage,
  type SessionSummary,
} from "@remotty/protocol"
import { readConfig, type RelayConfig } from "./config.js"
import { selectOpenSessions } from "./sessions.js"

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

export const remottyPlugin: Plugin = async ({ client, directory }) => {
  const config = await resolveConfig()
  if (!config) {
    await client.app.log({
      body: {
        service: "remotty",
        level: "warn",
        message: "remotty is not paired. Run remotty pair.",
      },
    })
    return {}
  }

  const relay: RelayInfo = {
    id: createHash("sha256").update(`${hostname()}:${directory}`).digest("hex").slice(0, 16),
    name: config.name,
    hostname: hostname(),
    platform: platform(),
    arch: arch(),
    workspace: directory,
  }

  let socket: WebSocket | undefined
  let stopped = false
  let sequence = 0
  let reconnectDelay = 1_000
  let activeSessionId: string | undefined

  const send = (message: RelayMessage) => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
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

  const snapshot = async () => {
    const [sessions, statuses, vcs, agents, permissions, questions] = await Promise.all([
      sdkData(client.session.list()) as Promise<Array<JsonObject>>,
      sdkData(client.session.status()) as Promise<Record<string, { type: "idle" | "busy" | "retry" }>>,
      (sdkData(client.vcs.get()) as Promise<{ branch?: string | null }>).catch((): { branch?: string } => ({})),
      (sdkData(client.app.agents()) as Promise<Array<JsonObject>>).catch(() => []),
      sdkData(rawClient.get<PermissionRequest[]>({ url: "/permission" })).catch(() => []),
      sdkData(rawClient.get<QuestionRequest[]>({ url: "/question" })).catch(() => []),
    ])
    const selected = selectOpenSessions(sessions, statuses, activeSessionId)
    activeSessionId = selected.activeSessionId
    const openSessions = selected.sessions
    const summaries: SessionSummary[] = openSessions.map((session) => {
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
    send({
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
      permissions,
      questions,
    })
  }

  const reply = (requestId: string, result?: unknown, error?: unknown) => {
    send({
      type: "rpc.result",
      requestId,
      result,
      error: error instanceof Error ? error.message : error ? String(error) : undefined,
    })
  }

  const handleCommand = async (command: ClientCommand) => {
    try {
      switch (command.type) {
        case "snapshot.request":
          await snapshot()
          reply(command.requestId, true)
          break
        case "session.messages":
          reply(
            command.requestId,
            await sdkData(client.session.messages({ path: { id: command.sessionId }, query: { limit: 80 } })),
          )
          break
        case "session.diff":
          reply(command.requestId, await sdkData(client.session.diff({ path: { id: command.sessionId } })))
          break
        case "session.todos":
          reply(command.requestId, await sdkData(client.session.todo({ path: { id: command.sessionId } })))
          break
        case "session.prompt":
          const session = (await sdkData(
            client.session.get({ path: { id: command.sessionId } }),
          )) as unknown as JsonObject
          await sdkCall(
            client.session.promptAsync({
              path: { id: command.sessionId },
              body: {
                ...promptContext(session),
                ...(command.agent ? { agent: command.agent } : {}),
                parts: [{ type: "text", text: command.text }],
              },
            }),
          )
          reply(command.requestId, true)
          break
        case "session.abort":
          reply(
            command.requestId,
            await sdkData(client.session.abort({ path: { id: command.sessionId } })),
          )
          break
        case "permission.reply":
          reply(
            command.requestId,
            await sdkData(
              client.postSessionIdPermissionsPermissionId({
                path: { id: command.sessionId, permissionID: command.permissionId },
                body: { response: command.response },
              }),
            ),
          )
          break
        case "question.reply":
          reply(
            command.requestId,
            await sdkData(
              rawClient.post({
                url: `/question/${encodeURIComponent(command.questionId)}/reply`,
                body: { answers: command.answers },
              }),
            ),
          )
          break
        case "question.reject":
          reply(
            command.requestId,
            await sdkData(rawClient.post({ url: `/question/${encodeURIComponent(command.questionId)}/reject` })),
          )
          break
      }
    } catch (error) {
      reply(command.requestId, undefined, error)
    }
  }

  const connect = () => {
    if (stopped) return
    socket = new WebSocket(toWebSocketUrl(config.brokerUrl), ["remotty", config.code])
    socket.addEventListener("open", async () => {
      reconnectDelay = 1_000
      send({ type: "relay.hello", relay })
      await snapshot().catch((error) => reply("snapshot", undefined, error))
    })
    socket.addEventListener("message", (message) => {
      try {
        const command = clientCommandSchema.parse(JSON.parse(String(message.data)))
        void handleCommand(command)
      } catch (error) {
        void client.app.log({
          body: {
            service: "remotty",
            level: "warn",
            message: "Rejected invalid relay command",
            extra: { error: String(error) },
          },
        })
      }
    })
    socket.addEventListener("close", () => {
      if (stopped) return
      setTimeout(connect, reconnectDelay)
      reconnectDelay = Math.min(reconnectDelay * 2, 30_000)
    })
  }

  connect()

  return {
    event: async ({ event }) => {
      const eventType = String(event.type)
      send({
        type: "relay.event",
        sequence: sequence++,
        event: { type: eventType, properties: event.properties },
      })
      const properties = event.properties as JsonObject
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

async function resolveConfig(): Promise<RelayConfig | undefined> {
  const file = await readConfig()
  const brokerUrl = process.env.REMOTTY_URL ?? process.env.OPENCODE_RELAY_URL ?? file?.brokerUrl
  const code = process.env.REMOTTY_KEY ?? process.env.OPENCODE_RELAY_CODE ?? file?.code
  if (!brokerUrl || !code) return undefined
  return {
    brokerUrl,
    code,
    name: process.env.REMOTTY_NAME ?? process.env.OPENCODE_RELAY_NAME ?? file?.name ?? hostname(),
  }
}

export default remottyPlugin
