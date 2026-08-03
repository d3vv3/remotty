import { createServer, type IncomingMessage } from "node:http"
import { URL } from "node:url"
import { clientCommandSchema, relayMessageSchema, type ClientCommand } from "@remotty/protocol"
import { WebSocket, WebSocketServer, type RawData } from "ws"
import webpush, { type PushSubscription } from "web-push"
import { RelayRooms, type Room } from "./rooms.js"

const port = Number(process.env.PORT ?? 8787)
const rooms = new RelayRooms()
const maxClientFrameBytes = 100_000
const maxRelayFrameBytes = 8_000_000
const credentialPattern = /^[A-Za-z0-9_-]{32,128}$/
const generatedVapidKeys = webpush.generateVAPIDKeys()
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY ?? generatedVapidKeys.publicKey
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY ?? generatedVapidKeys.privateKey
webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? "mailto:admin@example.com", vapidPublicKey, vapidPrivateKey)

const send = (socket: WebSocket, message: unknown) => {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
}

const uniqueBy = <T>(items: T[], key: (item: T) => string) =>
  [...new Map(items.map((item) => [key(item), item])).values()]

const combinedSnapshot = (room: Room) => {
  const connections = [...room.relays.values()]
  const snapshots = connections.flatMap((connection) => connection.snapshot ? [connection.snapshot] : [])
  return {
    type: "broker.snapshot" as const,
    relays: connections.map((connection) => connection.relay),
    sessions: uniqueBy(snapshots.flatMap((snapshot) => snapshot.sessions), (session) => session.id)
      .sort((a, b) => b.updatedAt - a.updatedAt),
    agents: uniqueBy(snapshots.flatMap((snapshot) => snapshot.agents), (agent) => agent.name),
    permissions: uniqueBy(snapshots.flatMap((snapshot) => snapshot.permissions), (permission) => permission.id),
    questions: uniqueBy(snapshots.flatMap((snapshot) => snapshot.questions), (question) => question.id),
  }
}

const broadcastSnapshot = (room: Room) => {
  const snapshot = combinedSnapshot(room)
  for (const client of room.clients) send(client, snapshot)
}

const connectionForSession = (room: Room, sessionId: string) =>
  [...room.relays.values()].find((connection) =>
    connection.snapshot?.sessions.some((session) => session.id === sessionId),
  )

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
}

const readJson = async (request: IncomingMessage) => {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk)
    size += buffer.byteLength
    if (size > maxClientFrameBytes) throw new Error("Request body is too large")
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString()) as unknown
}

const sendPush = async (room: Room, payload: Record<string, unknown>) => {
  await Promise.all(
    [...room.pushSubscriptions.entries()].map(async ([endpoint, registration]) => {
      try {
        await webpush.sendNotification(
          registration.subscription,
          JSON.stringify({
            ...payload,
            data: {
              ...(payload.data as Record<string, unknown>),
              brokerUrl: registration.brokerUrl,
            },
          }),
        )
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode
        if (statusCode === 404 || statusCode === 410) room.pushSubscriptions.delete(endpoint)
      }
    }),
  )
}

const server = createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    response.writeHead(204, corsHeaders)
    response.end()
    return
  }
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json", ...corsHeaders })
    response.end(JSON.stringify({ healthy: true, push: true, rooms: rooms.size }))
    return
  }
  if (request.method === "GET" && request.url === "/push/public-key") {
    response.writeHead(200, { "content-type": "application/json", ...corsHeaders })
    response.end(JSON.stringify({ publicKey: vapidPublicKey }))
    return
  }
  if (request.method === "POST" && request.url === "/push/subscribe") {
    try {
      const body = (await readJson(request)) as {
        code?: string
        brokerUrl?: string
        subscription?: PushSubscription
      }
      const code = body.code
      if (!code?.match(credentialPattern) || !body.subscription?.endpoint || !body.brokerUrl) {
        throw new Error("Invalid Push subscription")
      }
      rooms.get(code).pushSubscriptions.set(body.subscription.endpoint, {
        subscription: body.subscription,
        brokerUrl: body.brokerUrl,
      })
      response.writeHead(204, corsHeaders)
      response.end()
    } catch (error) {
      response.writeHead(400, { "content-type": "application/json", ...corsHeaders })
      response.end(JSON.stringify({ error: (error as Error).message }))
    }
    return
  }
  if (request.method === "POST" && request.url === "/push/action") {
    try {
      const body = (await readJson(request)) as { code?: string; command?: unknown }
      const code = body.code
      if (!code?.match(credentialPattern)) throw new Error("Invalid pairing credential")
      const room = rooms.get(code)
      const command = clientCommandSchema.parse(body.command)
      const connection = "sessionId" in command ? connectionForSession(room, command.sessionId) : undefined
      if (!connection || connection.socket.readyState !== WebSocket.OPEN) throw new Error("Session relay is offline")
      connection.socket.send(JSON.stringify(command))
      response.writeHead(202, corsHeaders)
      response.end()
    } catch (error) {
      response.writeHead(400, { "content-type": "application/json", ...corsHeaders })
      response.end(JSON.stringify({ error: (error as Error).message }))
    }
    return
  }
  response.writeHead(404, corsHeaders)
  response.end("Not found")
})

const webSockets = new WebSocketServer({
  noServer: true,
  handleProtocols: (protocols) => (protocols.has("remotty") ? "remotty" : false),
})

const credentialFrom = (request: IncomingMessage) => {
  const protocols = request.headers["sec-websocket-protocol"]?.split(",").map((protocol) => protocol.trim()) ?? []
  return protocols[0] === "remotty" ? protocols[1] : undefined
}

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`)
  const role = url.searchParams.get("role")
  const code = credentialFrom(request)

  if (url.pathname !== "/ws" || !code?.match(credentialPattern) || !["relay", "client"].includes(role ?? "")) {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n")
    socket.destroy()
    return
  }

  webSockets.handleUpgrade(request, socket, head, (webSocket) => {
    webSockets.emit("connection", webSocket, request)
  })
})

webSockets.on("connection", (socket: WebSocket, request: IncomingMessage) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`)
  const code = credentialFrom(request)!
  const role = url.searchParams.get("role")!
  const room = rooms.get(code)
  let relayId: string | undefined

  if (role === "client") {
    room.clients.add(socket)
  }

  send(socket, { type: "broker.ready", relayConnected: room.relays.size > 0 })
  if (role === "client") send(socket, combinedSnapshot(room))

  socket.on("message", (data: RawData, isBinary: boolean) => {
    const payload = data.toString()
    const maxFrameBytes = role === "relay" ? maxRelayFrameBytes : maxClientFrameBytes
    if (isBinary || Buffer.byteLength(payload) > maxFrameBytes) {
      socket.close(1009, "Unsupported message")
      return
    }

    if (role === "relay") {
      let message
      try {
        message = relayMessageSchema.parse(JSON.parse(payload))
      } catch {
        send(socket, { type: "broker.error", message: "Relay sent invalid JSON" })
        return
      }
      if (message.type === "relay.hello") {
        relayId = message.relay.id
        const existing = room.relays.get(relayId)
        room.relays.set(relayId, { socket, relay: message.relay, snapshot: existing?.snapshot })
        if (existing && existing.socket !== socket) existing.socket.close(4001, "Workspace relay replaced")
        for (const client of room.clients) send(client, { type: "broker.relay-status", connected: true })
        broadcastSnapshot(room)
        return
      }
      if (message.type === "relay.snapshot") {
        relayId = message.relay.id
        const existing = room.relays.get(relayId)
        if (existing && existing.socket !== socket) existing.socket.close(4001, "Workspace relay replaced")
        room.relays.set(relayId, { socket, relay: message.relay, snapshot: message })
        broadcastSnapshot(room)
        return
      }
      if (message.type === "relay.event") {
        const event = message.event as { type?: string; properties?: Record<string, unknown> }
        if (event.type === "permission.asked" && event.properties) {
          const patterns = Array.isArray(event.properties.patterns) ? event.properties.patterns.map(String) : []
          void sendPush(room, {
            title: "OpenCode needs permission",
            body: `${String(event.properties.permission ?? "Action")}: ${patterns.join(", ")}`,
            tag: `permission-${String(event.properties.id)}`,
            requireInteraction: true,
            actions: [
              { action: "reject", title: "Reject" },
              { action: "once", title: "Once" },
              { action: "always", title: "Always" },
            ],
            data: {
              code,
              type: "permission",
              permissionId: String(event.properties.id),
              sessionId: String(event.properties.sessionID),
            },
          })
        }
        if (event.type === "permission.replied" && event.properties) {
          const permissionId = String(event.properties.requestID ?? event.properties.permissionID ?? "")
          if (permissionId) void sendPush(room, { closeTag: `permission-${permissionId}`, data: {} })
        }
        if (event.type === "question.asked" && event.properties) {
          const questions = event.properties.questions as Array<{ question?: string }> | undefined
          void sendPush(room, {
            title: "OpenCode has a question",
            body: questions?.[0]?.question ?? "Open the relay to answer.",
            tag: `question-${String(event.properties.id)}`,
            data: {
              code,
              type: "question",
              sessionId: String(event.properties.sessionID),
            },
          })
        }
        if (["question.replied", "question.rejected"].includes(event.type ?? "") && event.properties) {
          const questionId = String(event.properties.requestID ?? "")
          if (questionId) void sendPush(room, { closeTag: `question-${questionId}`, data: {} })
        }
      }
      for (const client of room.clients) {
        client.send(payload)
      }
      return
    }

    let command: ClientCommand
    try {
      command = clientCommandSchema.parse(JSON.parse(payload))
    } catch {
      send(socket, { type: "broker.error", message: "Client sent an invalid command" })
      return
    }
    if (command.type === "snapshot.request") {
      if (room.relays.size === 0) {
        send(socket, { type: "rpc.result", requestId: command.requestId, error: "Relay is offline" })
        return
      }
      for (const connection of room.relays.values()) connection.socket.send(payload)
      return
    }
    const connection = connectionForSession(room, command.sessionId)
    if (!connection || connection.socket.readyState !== WebSocket.OPEN) {
      send(socket, {
        type: "rpc.result",
        requestId: command.requestId,
        error: "The OpenCode relay for this session is offline.",
      })
      return
    }
    connection.socket.send(payload)
  })

  socket.on("close", () => {
    if (role === "relay" && relayId && room.relays.get(relayId)?.socket === socket) {
      room.relays.delete(relayId)
      for (const client of room.clients) {
        send(client, { type: "broker.relay-status", connected: room.relays.size > 0 })
      }
      broadcastSnapshot(room)
    } else {
      room.clients.delete(socket)
    }
    rooms.removeIfEmpty(code)
  })
})

const heartbeat = setInterval(() => {
  for (const socket of webSockets.clients) {
    if (socket.readyState === WebSocket.OPEN) socket.ping()
  }
}, 30_000)

server.listen(port, "0.0.0.0", () => {
  console.log(`remotty broker listening on http://localhost:${port}`)
})

const shutdown = () => {
  clearInterval(heartbeat)
  webSockets.close()
  server.close()
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
