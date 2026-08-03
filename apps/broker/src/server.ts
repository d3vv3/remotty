/// <reference lib="dom" />

import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { lookup } from "node:dns/promises"
import { isIP } from "node:net"
import { randomBytes } from "node:crypto"
import { URL } from "node:url"
import {
  brokerTransportControlSchema,
  brokerTransportHelloSchema,
  deviceCertificatePayload,
  ecPublicJwkSchema,
  e2eeFrameSchema,
  signingKeyFingerprint,
  transportProofPayload,
  verifyCanonicalJson,
  verifyFrameSignature,
  type BrokerTransportControl,
  type EcPublicJwk,
  type JsonValue,
} from "@remotty/protocol"
import webpush, { type PushSubscription } from "web-push"
import { WebSocket, WebSocketServer, type RawData } from "ws"
import {
  RelayRooms,
  isRoomToken,
  registerClient,
  registerRelay,
  registrationsForDevice,
  removeClient,
  removeRelay,
  routeClientFrame,
  routeRelayFrame,
  type PushRegistration,
  type Room,
  type RouteResult,
} from "./rooms.js"

const port = Number(process.env.PORT ?? 8787)
const rooms = new RelayRooms()
const maxClientFrameBytes = 100_000
const maxRelayFrameBytes = 8_000_000
const maxIdentityLength = 512
const maxPushRegistrationsPerDevice = 5
const maxPushRegistrationsPerRoom = 100
const authorizationMaxAgeMs = 2 * 60 * 1_000
const maxConnectionsPerRoom = 64
const roomConnectionCounts = new Map<string, number>()
const enrollmentRates = new Map<string, { startedAt: number; count: number }>()
const generatedVapidKeys = webpush.generateVAPIDKeys()
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY ?? generatedVapidKeys.publicKey
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY ?? generatedVapidKeys.privateKey
webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? "mailto:admin@example.com", vapidPublicKey, vapidPrivateKey)

const isIdentity = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= maxIdentityLength && value !== "*"

const sendControl = (socket: WebSocket, control: BrokerTransportControl) => {
  if (socket.readyState !== WebSocket.OPEN) return
  socket.send(JSON.stringify(brokerTransportControlSchema.parse(control)))
}

const sendError = (socket: WebSocket, code: string, message: string) =>
  sendControl(socket, { type: "broker.error", version: 2, code, message })

const broadcastRelayStatus = (room: Room, relayId: string, connected: boolean) => {
  for (const client of room.clients.values()) {
    sendControl(client, { type: "broker.relay-status", version: 2, relayId, connected })
  }
}

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
    if (size > maxClientFrameBytes) throw new Error("request_too_large")
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString()) as unknown
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const hasOnlyKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).every((key) => keys.includes(key))

const isPushEndpoint = (value: unknown): value is string => {
  if (typeof value !== "string" || value.length === 0 || value.length > 4096) return false
  try {
    const url = new URL(value)
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "")
    const privateHost = hostname === "localhost" || hostname.endsWith(".local") || hostname === "::1" ||
      /^127\./.test(hostname) || /^10\./.test(hostname) || /^192\.168\./.test(hostname) ||
      /^169\.254\./.test(hostname) || /^172\.(?:1[6-9]|2\d|3[01])\./.test(hostname) ||
      /^f[cd][0-9a-f]{2}:/i.test(hostname) || /^fe[89ab][0-9a-f]:/i.test(hostname) ||
      /^::ffff:(?:127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)/i.test(hostname)
    return url.protocol === "https:" && (!url.port || url.port === "443") && !url.username && !url.password && !privateHost
  } catch {
    return false
  }
}

const isPublicAddress = (address: string) => {
  if (isIP(address) === 4) {
    return !/^127\.|^10\.|^192\.168\.|^169\.254\.|^172\.(?:1[6-9]|2\d|3[01])\./.test(address) && address !== "0.0.0.0"
  }
  const normalized = address.toLowerCase()
  return normalized !== "::" && normalized !== "::1" && !/^f[cd]/.test(normalized) && !/^fe[89ab]/.test(normalized) &&
    !/^::ffff:(?:127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(normalized)
}

const isPublicPushEndpoint = async (endpoint: string) => {
  if (!isPushEndpoint(endpoint)) return false
  const addresses = await lookup(new URL(endpoint).hostname, { all: true }).catch(() => [])
  return addresses.length > 0 && addresses.every(({ address }) => isPublicAddress(address))
}

const jsonValue = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue

type PushAuthorization = {
  roomToken: string
  deviceId: string
  signingPublicKey: EcPublicJwk
  authorization: Record<string, JsonValue>
}

const verifyPushAuthorization = async (
  value: unknown,
  operation: "subscribe" | "unsubscribe",
): Promise<PushAuthorization | undefined> => {
  if (!isRecord(value)) return undefined
  const detailKey = operation === "subscribe" ? "subscription" : "endpoint"
  if (!hasOnlyKeys(value, ["operation", "roomToken", "deviceId", "issuedAt", "nonce", detailKey, "signingPublicKey", "relaySigningKey", "deviceCertificate", "signature"]) ||
    value.operation !== operation || !isRoomToken(value.roomToken) || !isIdentity(value.deviceId) ||
    typeof value.issuedAt !== "number" || Math.abs(Date.now() - value.issuedAt) > authorizationMaxAgeMs ||
    typeof value.nonce !== "string" || !value.nonce || typeof value.signature !== "string" ||
    typeof value.deviceCertificate !== "string") return undefined
  const key = ecPublicJwkSchema.safeParse(value.signingPublicKey)
  const relayKey = ecPublicJwkSchema.safeParse(value.relaySigningKey)
  if (!key.success || !relayKey.success || await signingKeyFingerprint(key.data) !== value.deviceId ||
    await signingKeyFingerprint(relayKey.data) !== value.roomToken ||
    !await verifyCanonicalJson(
      deviceCertificatePayload(value.deviceId, value.roomToken),
      value.deviceCertificate,
      relayKey.data,
    ).catch(() => false)) return undefined
  const authorization = jsonValue({
    operation,
    roomToken: value.roomToken,
    deviceId: value.deviceId,
    issuedAt: value.issuedAt,
    nonce: value.nonce,
    [detailKey]: value[detailKey],
  }) as Record<string, JsonValue>
  if (!await verifyCanonicalJson(authorization, value.signature, key.data).catch(() => false)) return undefined
  return { roomToken: value.roomToken, deviceId: value.deviceId, signingPublicKey: key.data, authorization }
}

const parseSubscription = (value: unknown): PushSubscription | undefined => {
  if (!isRecord(value) || !hasOnlyKeys(value, ["endpoint", "expirationTime", "keys"])) return undefined
  if (!isPushEndpoint(value.endpoint)) return undefined
  if (value.expirationTime !== undefined && value.expirationTime !== null &&
    (typeof value.expirationTime !== "number" || !Number.isFinite(value.expirationTime))) {
    return undefined
  }
  if (!isRecord(value.keys) || !hasOnlyKeys(value.keys, ["auth", "p256dh"])) return undefined
  if (typeof value.keys.auth !== "string" || value.keys.auth.length === 0 || value.keys.auth.length > 1024) return undefined
  if (typeof value.keys.p256dh !== "string" || value.keys.p256dh.length === 0 || value.keys.p256dh.length > 1024) return undefined
  return {
    endpoint: value.endpoint,
    expirationTime: value.expirationTime as number | null | undefined,
    keys: { auth: value.keys.auth, p256dh: value.keys.p256dh },
  }
}

const jsonResponse = (response: ServerResponse, status: number, body?: unknown) => {
  const headers = body === undefined ? corsHeaders : { "content-type": "application/json", ...corsHeaders }
  response.writeHead(status, headers)
  response.end(body === undefined ? undefined : JSON.stringify(body))
}

const badRequest = (response: ServerResponse, code = "invalid_request") => jsonResponse(response, 400, { error: code })

const sendPushFrame = async (room: Room, registrations: PushRegistration[], payload: string) => {
  await Promise.all(registrations.map(async (registration) => {
    try {
      if (!await isPublicPushEndpoint(registration.subscription.endpoint)) throw new Error("push_endpoint_not_public")
      await webpush.sendNotification(registration.subscription, payload)
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode
      const endpoint = registration.subscription.endpoint
      if ((statusCode === 404 || statusCode === 410) && room.pushRegistrations.get(endpoint) === registration) {
        room.pushRegistrations.delete(endpoint)
      }
    }
  }))
}

const deliverRoute = (room: Room, route: RouteResult, payload: string) => {
  if (!route.ok) return
  if (route.kind === "push") {
    void sendPushFrame(room, route.registrations, payload)
    return
  }
  for (const target of route.sockets) target.send(payload)
}

const server = createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    jsonResponse(response, 204)
    return
  }
  if (request.url === "/health") {
    jsonResponse(response, 200, { healthy: true, push: true, rooms: rooms.size })
    return
  }
  if (request.method === "GET" && request.url === "/push/public-key") {
    jsonResponse(response, 200, { publicKey: vapidPublicKey })
    return
  }
  if (request.method === "POST" && request.url === "/push/subscribe") {
    try {
      const body = await readJson(request)
      const authorization = await verifyPushAuthorization(body, "subscribe")
      const subscription = parseSubscription(authorization?.authorization.subscription)
      if (!authorization || !subscription || !await isPublicPushEndpoint(subscription.endpoint)) {
        return badRequest(response, "invalid_authorization")
      }
      const room = rooms.get(authorization.roomToken)
      const existing = room.pushRegistrations.get(subscription.endpoint)
      const deviceRegistrations = [...room.pushRegistrations.values()].filter((item) => item.deviceId === authorization.deviceId)
      if (!existing && (deviceRegistrations.length >= maxPushRegistrationsPerDevice || room.pushRegistrations.size >= maxPushRegistrationsPerRoom)) {
        return badRequest(response, "registration_limit")
      }
      room.pushRegistrations.set(subscription.endpoint, {
        deviceId: authorization.deviceId,
        signingPublicKey: authorization.signingPublicKey,
        subscription,
      })
      jsonResponse(response, 204)
    } catch (error) {
      badRequest(response, (error as Error).message === "request_too_large" ? "request_too_large" : "invalid_request")
    }
    return
  }
  if (request.method === "POST" && request.url === "/push/unsubscribe") {
    try {
      const body = await readJson(request)
      const authorization = await verifyPushAuthorization(body, "unsubscribe")
      const endpoint = authorization?.authorization.endpoint
      if (!authorization || !isPushEndpoint(endpoint)) return badRequest(response, "invalid_authorization")
      const room = rooms.peek(authorization.roomToken)
      const registration = room?.pushRegistrations.get(endpoint)
      if (room && registration?.deviceId === authorization.deviceId) {
        room.pushRegistrations.delete(endpoint)
        rooms.removeIfEmpty(authorization.roomToken)
      }
      jsonResponse(response, 204)
    } catch (error) {
      badRequest(response, (error as Error).message === "request_too_large" ? "request_too_large" : "invalid_request")
    }
    return
  }
  if (request.method === "POST" && request.url === "/push/action") {
    try {
      const body = await readJson(request)
      if (!isRecord(body) || !hasOnlyKeys(body, ["roomToken", "frame"]) || !isRoomToken(body.roomToken)) {
        return badRequest(response)
      }
      const parsed = e2eeFrameSchema.safeParse(body.frame)
      if (!parsed.success || parsed.data.channel !== "data" || !isIdentity(parsed.data.sender) || !isIdentity(parsed.data.recipient)) {
        return badRequest(response, "invalid_frame")
      }
      const room = rooms.peek(body.roomToken)
      const registration = room && registrationsForDevice(room, parsed.data.sender)[0]
      if (!registration || !(await verifyFrameSignature(parsed.data, registration.signingPublicKey).catch(() => false)) ||
        Math.abs(Date.now() - parsed.data.issuedAt) > authorizationMaxAgeMs) {
        return badRequest(response, "invalid_authorization")
      }
      const relay = room?.relays.get(parsed.data.recipient)
      if (!relay || relay.readyState !== WebSocket.OPEN) return badRequest(response, "relay_offline")
      relay.send(JSON.stringify(body.frame))
      jsonResponse(response, 202)
    } catch (error) {
      badRequest(response, (error as Error).message === "request_too_large" ? "request_too_large" : "invalid_request")
    }
    return
  }
  response.writeHead(404, corsHeaders)
  response.end("Not found")
})

const webSockets = new WebSocketServer({
  noServer: true,
  maxPayload: maxRelayFrameBytes,
  handleProtocols: (protocols) => (protocols.has("remotty") ? "remotty" : false),
})

const credentialFrom = (request: IncomingMessage) => {
  const protocols = request.headers["sec-websocket-protocol"]?.split(",").map((protocol) => protocol.trim()) ?? []
  return protocols.length === 2 && protocols[0] === "remotty" ? protocols[1] : undefined
}

server.on("upgrade", (request, socket, head) => {
  let url: URL
  try {
    url = new URL(request.url ?? "/", "http://broker.invalid")
  } catch {
    socket.destroy()
    return
  }
  const role = url.searchParams.get("role")
  const roomToken = credentialFrom(request)

  if (url.pathname !== "/ws" || !isRoomToken(roomToken) || (role !== "relay" && role !== "client")) {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n")
    socket.destroy()
    return
  }

  webSockets.handleUpgrade(request, socket, head, (webSocket) => webSockets.emit("connection", webSocket, request))
})

const alive = new WeakMap<WebSocket, boolean>()

webSockets.on("connection", (socket: WebSocket, request: IncomingMessage) => {
  const url = new URL(request.url ?? "/", "http://broker.invalid")
  const roomToken = credentialFrom(request)!
  const role = url.searchParams.get("role") as "relay" | "client"
  const room = rooms.get(roomToken)
  const connectionCount = (roomConnectionCounts.get(roomToken) ?? 0) + 1
  roomConnectionCounts.set(roomToken, connectionCount)
  if (connectionCount > maxConnectionsPerRoom) {
    roomConnectionCounts.set(roomToken, connectionCount - 1)
    socket.close(1013, "room_connection_limit")
    return
  }
  let identity: string | undefined
  const challenge = randomBytes(32).toString("base64url")
  sendControl(socket, { type: "broker.challenge", version: 2, nonce: challenge })
  const helloTimeout = setTimeout(() => {
    if (!identity) socket.close(1008, "hello_timeout")
  }, 5_000)
  let rateStartedAt = Date.now()
  let messageCount = 0
  alive.set(socket, true)
  socket.on("pong", () => alive.set(socket, true))

  const reject = (code: string, message: string, close = false) => {
    sendError(socket, code, message)
    if (close) socket.close(1008, code)
  }

  const handleMessage = async (data: RawData, isBinary: boolean) => {
    if (Date.now() - rateStartedAt >= 60_000) {
      rateStartedAt = Date.now()
      messageCount = 0
    }
    messageCount += 1
    if (messageCount > (role === "relay" ? 3_000 : 600)) {
      socket.close(1008, "message_rate_limit")
      return
    }
    const payload = data.toString()
    const maxFrameBytes = role === "relay" ? maxRelayFrameBytes : maxClientFrameBytes
    if (isBinary || Buffer.byteLength(payload) > maxFrameBytes) {
      socket.close(1009, "unsupported_message")
      return
    }

    let decoded: unknown
    try {
      decoded = JSON.parse(payload)
    } catch {
      reject("invalid_json", "Message must be valid JSON", identity === undefined)
      return
    }

    if (identity === undefined) {
      const hello = brokerTransportHelloSchema.safeParse(decoded)
      if (!hello.success) {
        reject("hello_required", "The first message must be transport.hello v2", true)
        return
      }
      if (hello.data.role !== role) {
        reject("role_mismatch", "Transport role does not match authenticated socket role", true)
        return
      }
      const nextIdentity = role === "relay" ? (hello.data as Extract<typeof hello.data, { role: "relay" }>).relayId
        : (hello.data as Extract<typeof hello.data, { role: "client" }>).deviceId
      if (!isIdentity(nextIdentity)) {
        reject("identity_invalid", "Transport identity is invalid", true)
        return
      }
      const fingerprint = await signingKeyFingerprint(hello.data.publicKey)
      const expectedFingerprint = role === "relay" ? roomToken : nextIdentity
      const proof = transportProofPayload(role, nextIdentity, roomToken, challenge)
      if (fingerprint !== expectedFingerprint ||
        !(await verifyCanonicalJson(proof, hello.data.signature, hello.data.publicKey).catch(() => false))) {
        reject("identity_proof_invalid", "Transport identity proof is invalid", true)
        return
      }
      identity = nextIdentity
      clearTimeout(helloTimeout)
      if (role === "relay") {
        if (!registerRelay(room, identity, socket)) {
          reject("identity_in_use", "Transport identity already has an active connection", true)
          return
        }
        broadcastRelayStatus(room, identity, true)
      } else {
        if (!registerClient(room, identity, socket)) {
          reject("identity_in_use", "Transport identity already has an active connection", true)
          return
        }
        sendControl(socket, {
          type: "broker.ready",
          version: 2,
          connectedRelayIds: [...room.relays.entries()]
            .filter(([, relay]) => relay.readyState === WebSocket.OPEN)
            .map(([relayId]) => relayId),
        })
      }
      return
    }

    if (brokerTransportHelloSchema.safeParse(decoded).success) {
      reject("hello_duplicate", "Transport identity is already bound")
      return
    }
    const isCurrentIdentity = role === "relay"
      ? room.relays.get(identity) === socket
      : room.clients.get(identity) === socket
    if (!isCurrentIdentity) {
      reject("identity_replaced", "Transport identity has been replaced", true)
      return
    }
    const frame = e2eeFrameSchema.safeParse(decoded)
    if (!frame.success) {
      reject("invalid_frame", "Message must be an E2EE v2 frame")
      return
    }
    if (role === "client" && frame.data.channel === "enroll") {
      let rate = enrollmentRates.get(roomToken)
      if (!rate || Date.now() - rate.startedAt >= 60_000) {
        rate = { startedAt: Date.now(), count: 0 }
        enrollmentRates.set(roomToken, rate)
      }
      rate.count += 1
      if (rate.count > 20) {
        reject("enrollment_rate_limit", "Too many enrollment attempts")
        return
      }
    }

    const route = role === "relay"
      ? routeRelayFrame(room, identity, frame.data)
      : routeClientFrame(room, identity, frame.data)
    if (!route.ok) {
      reject(route.code, route.message)
      return
    }
    deliverRoute(room, route, payload)
  }
  let messageQueue = Promise.resolve()
  socket.on("message", (data: RawData, isBinary: boolean) => {
    messageQueue = messageQueue.then(() => handleMessage(data, isBinary)).catch(() => {
      reject("message_processing_failed", "Broker could not process the message", true)
    })
  })

  socket.on("close", () => {
    clearTimeout(helloTimeout)
    if (identity && role === "relay" && removeRelay(room, identity, socket)) {
      broadcastRelayStatus(room, identity, false)
    } else if (identity && role === "client") {
      removeClient(room, identity, socket)
    }
    rooms.removeIfEmpty(roomToken)
    const remaining = Math.max(0, (roomConnectionCounts.get(roomToken) ?? 1) - 1)
    if (remaining) roomConnectionCounts.set(roomToken, remaining)
    else roomConnectionCounts.delete(roomToken)
  })
})

const heartbeat = setInterval(() => {
  for (const socket of webSockets.clients) {
    if (alive.get(socket) === false) {
      socket.terminate()
      continue
    }
    alive.set(socket, false)
    socket.ping()
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
