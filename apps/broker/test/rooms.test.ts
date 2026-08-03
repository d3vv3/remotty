import type { E2eeFrame } from "@remotty/protocol"
import type { WebSocket } from "ws"
import { WebSocket as WebSocketState } from "ws"
import { describe, expect, it } from "vitest"
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
} from "../src/rooms"

const socket = (readyState: number = WebSocketState.OPEN) => ({ readyState } as WebSocket)
const signingPublicKey = { kty: "EC" as const, crv: "P-256" as const, x: "A".repeat(43), y: "B".repeat(43) }
const frame = (values: Partial<E2eeFrame> = {}): E2eeFrame => ({
  type: "e2ee.frame",
  version: 2,
  channel: "data",
  sender: "device-1",
  recipient: "relay-1",
  messageId: "message-1",
  issuedAt: 1,
  nonce: "AAAAAAAAAAAAAAAA",
  ciphertext: "opaque",
  signature: "A".repeat(86),
  ...values,
})

describe("RelayRooms", () => {
  it("accepts only canonical 32-byte room tokens", () => {
    const token = Buffer.alloc(32, 42).toString("base64url")
    expect(token).toHaveLength(43)
    expect(isRoomToken(token)).toBe(true)
    expect(isRoomToken("A".repeat(42))).toBe(false)
    expect(isRoomToken("A".repeat(44))).toBe(false)
    expect(isRoomToken(`${token.slice(0, -1)}B`)).toBe(false)
  })

  it("reuses rooms and removes empty rooms", () => {
    const rooms = new RelayRooms()
    const first = rooms.get("token")
    expect(rooms.get("token")).toBe(first)
    expect(rooms.size).toBe(1)
    rooms.removeIfEmpty("token")
    expect(rooms.size).toBe(0)
  })

  it("retains rooms for relays, clients, or push registrations", () => {
    const relayRooms = new RelayRooms()
    registerRelay(relayRooms.get("relay"), "relay-1", socket())
    relayRooms.removeIfEmpty("relay")

    const clientRooms = new RelayRooms()
    registerClient(clientRooms.get("client"), "device-1", socket())
    clientRooms.removeIfEmpty("client")

    const pushRooms = new RelayRooms()
    pushRooms.get("push").pushRegistrations.set("https://push.example/1", {
      deviceId: "device-1",
      signingPublicKey,
      subscription: { endpoint: "https://push.example/1", keys: { auth: "auth", p256dh: "key" } },
    })
    pushRooms.removeIfEmpty("push")

    expect(relayRooms.size).toBe(1)
    expect(clientRooms.size).toBe(1)
    expect(pushRooms.size).toBe(1)
  })
})

describe("identity registration", () => {
  it("rejects duplicate active identities", () => {
    const room = new RelayRooms().get("token")
    const oldRelay = socket()
    const newRelay = socket()
    const oldClient = socket()
    const newClient = socket()

    expect(registerRelay(room, "relay-1", oldRelay)).toBe(true)
    expect(registerRelay(room, "relay-1", newRelay)).toBe(false)
    expect(registerClient(room, "device-1", oldClient)).toBe(true)
    expect(registerClient(room, "device-1", newClient)).toBe(false)
    expect(room.relays.get("relay-1")).toBe(oldRelay)
    expect(room.clients.get("device-1")).toBe(oldClient)
  })
})

describe("opaque frame routing", () => {
  it("routes relay data only to its concrete device recipient", () => {
    const room = new RelayRooms().get("token")
    const target = socket()
    registerClient(room, "device-1", target)
    registerClient(room, "device-2", socket())

    expect(routeRelayFrame(room, "relay-1", frame({ sender: "relay-1", recipient: "device-1" }))).toEqual({
      ok: true,
      kind: "socket",
      sockets: [target],
    })
  })

  it("broadcasts client enrollment to open relays and routes data to one relay", () => {
    const room = new RelayRooms().get("token")
    const first = socket()
    const second = socket()
    registerRelay(room, "relay-1", first)
    registerRelay(room, "relay-2", second)
    registerRelay(room, "relay-offline", socket(WebSocketState.CLOSED))

    expect(routeClientFrame(room, "device-1", frame({ channel: "enroll", recipient: "*" }))).toEqual({
      ok: true,
      kind: "socket",
      sockets: [first, second],
    })
    expect(routeClientFrame(room, "device-1", frame({ recipient: "relay-2" }))).toEqual({
      ok: true,
      kind: "socket",
      sockets: [second],
    })
  })

  it.each([
    ["relay sender", routeRelayFrame, "relay-1", frame({ sender: "other", recipient: "device-1" }), "identity_mismatch"],
    ["relay enrollment", routeRelayFrame, "relay-1", frame({ channel: "enroll", sender: "relay-1", recipient: "device-1" }), "channel_forbidden"],
    ["relay wildcard", routeRelayFrame, "relay-1", frame({ sender: "relay-1", recipient: "*" }), "recipient_invalid"],
    ["client sender", routeClientFrame, "device-1", frame({ sender: "other" }), "identity_mismatch"],
    ["client push", routeClientFrame, "device-1", frame({ channel: "push" }), "channel_forbidden"],
    ["client enroll recipient", routeClientFrame, "device-1", frame({ channel: "enroll", recipient: "relay-1" }), "recipient_invalid"],
  ])("rejects invalid %s", (_name, route, identity, value, code) => {
    const result = route(new RelayRooms().get("token"), identity, value)
    expect(result).toMatchObject({ ok: false, code })
  })

  it("filters push registrations by recipient device", () => {
    const room = new RelayRooms().get("token")
    const first = { deviceId: "device-1", signingPublicKey, subscription: { endpoint: "https://push.example/1", keys: { auth: "a", p256dh: "b" } } }
    const second = { deviceId: "device-2", signingPublicKey, subscription: { endpoint: "https://push.example/2", keys: { auth: "a", p256dh: "b" } } }
    room.pushRegistrations.set(first.subscription.endpoint, first)
    room.pushRegistrations.set(second.subscription.endpoint, second)

    expect(registrationsForDevice(room, "device-1")).toEqual([first])
    expect(routeRelayFrame(room, "relay-1", frame({ channel: "push", sender: "relay-1", recipient: "device-1" }))).toEqual({
      ok: true,
      kind: "push",
      registrations: [first],
    })
  })
})
