import type { E2eeFrame, EcPublicJwk } from "@remotty/protocol"
import type { PushSubscription } from "web-push"
import { WebSocket } from "ws"

const credentialPattern = /^[A-Za-z0-9_-]{43}$/

export const isRoomToken = (value: unknown): value is string => {
  if (typeof value !== "string" || !credentialPattern.test(value)) return false
  const decoded = Buffer.from(value, "base64url")
  return decoded.byteLength === 32 && decoded.toString("base64url") === value
}

export type PushRegistration = {
  deviceId: string
  signingPublicKey: EcPublicJwk
  subscription: PushSubscription
}

export type Room = {
  relays: Map<string, WebSocket>
  clients: Map<string, WebSocket>
  pushRegistrations: Map<string, PushRegistration>
}

export type RouteResult =
  | { ok: true; kind: "socket"; sockets: WebSocket[] }
  | { ok: true; kind: "push"; registrations: PushRegistration[] }
  | { ok: false; code: string; message: string }

const routeError = (code: string, message: string): RouteResult => ({ ok: false, code, message })
const isConcreteRecipient = (recipient: string) => recipient !== "*"
const openSockets = (sockets: Iterable<WebSocket>) =>
  [...sockets].filter((socket) => socket.readyState === WebSocket.OPEN)

export const registerRelay = (room: Room, relayId: string, socket: WebSocket) => {
  const existing = room.relays.get(relayId)
  if (existing && existing !== socket && existing.readyState === WebSocket.OPEN) return false
  room.relays.set(relayId, socket)
  return true
}

export const registerClient = (room: Room, deviceId: string, socket: WebSocket) => {
  const existing = room.clients.get(deviceId)
  if (existing && existing !== socket && existing.readyState === WebSocket.OPEN) return false
  room.clients.set(deviceId, socket)
  return true
}

export const removeRelay = (room: Room, relayId: string, socket: WebSocket) => {
  if (room.relays.get(relayId) !== socket) return false
  room.relays.delete(relayId)
  return true
}

export const removeClient = (room: Room, deviceId: string, socket: WebSocket) => {
  if (room.clients.get(deviceId) !== socket) return false
  room.clients.delete(deviceId)
  return true
}

export const registrationsForDevice = (room: Room, deviceId: string) =>
  [...room.pushRegistrations.values()].filter((registration) => registration.deviceId === deviceId)

export const routeRelayFrame = (room: Room, relayId: string, frame: E2eeFrame): RouteResult => {
  if (frame.sender !== relayId) return routeError("identity_mismatch", "Frame sender does not match relay identity")
  if (!isConcreteRecipient(frame.recipient)) {
    return routeError("recipient_invalid", "Relay frames require a concrete device recipient")
  }
  if (frame.channel === "enroll") return routeError("channel_forbidden", "Relays cannot send enrollment frames")
  if (frame.channel === "push") {
    return { ok: true, kind: "push", registrations: registrationsForDevice(room, frame.recipient) }
  }

  const client = room.clients.get(frame.recipient)
  if (!client || client.readyState !== WebSocket.OPEN) {
    return routeError("client_offline", "Recipient device is not connected")
  }
  return { ok: true, kind: "socket", sockets: [client] }
}

export const routeClientFrame = (room: Room, deviceId: string, frame: E2eeFrame): RouteResult => {
  if (frame.sender !== deviceId) return routeError("identity_mismatch", "Frame sender does not match client identity")
  if (frame.channel === "push") return routeError("channel_forbidden", "Clients cannot send push frames")
  if (frame.channel === "enroll") {
    if (frame.recipient !== "*") return routeError("recipient_invalid", "Enrollment frames must use the wildcard recipient")
    return { ok: true, kind: "socket", sockets: openSockets(room.relays.values()) }
  }
  if (!isConcreteRecipient(frame.recipient)) {
    return routeError("recipient_invalid", "Data frames require a concrete relay recipient")
  }

  const relay = room.relays.get(frame.recipient)
  if (!relay || relay.readyState !== WebSocket.OPEN) {
    return routeError("relay_offline", "Recipient relay is not connected")
  }
  return { ok: true, kind: "socket", sockets: [relay] }
}

export class RelayRooms {
  private readonly rooms = new Map<string, Room>()

  get(roomToken: string): Room {
    let room = this.rooms.get(roomToken)
    if (!room) {
      room = { relays: new Map(), clients: new Map(), pushRegistrations: new Map() }
      this.rooms.set(roomToken, room)
    }
    return room
  }

  peek(roomToken: string): Room | undefined {
    return this.rooms.get(roomToken)
  }

  removeIfEmpty(roomToken: string): void {
    const room = this.rooms.get(roomToken)
    if (room && room.relays.size === 0 && room.clients.size === 0 && room.pushRegistrations.size === 0) {
      this.rooms.delete(roomToken)
    }
  }

  get size(): number {
    return this.rooms.size
  }
}
