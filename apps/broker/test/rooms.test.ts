import { describe, expect, it } from "vitest"
import { RelayRooms } from "../src/rooms"
import type { WebSocket } from "ws"

describe("RelayRooms", () => {
  it("reuses rooms and removes empty rooms", () => {
    const rooms = new RelayRooms()
    const first = rooms.get("ABC123")
    expect(rooms.get("ABC123")).toBe(first)
    expect(rooms.size).toBe(1)
    rooms.removeIfEmpty("ABC123")
    expect(rooms.size).toBe(0)
  })

  it("keeps rooms with push subscriptions", () => {
    const rooms = new RelayRooms()
    rooms.get("ABC123").pushSubscriptions.set("https://push.example/1", {
      brokerUrl: "https://relay.example",
      subscription: {
        endpoint: "https://push.example/1",
        keys: { auth: "auth", p256dh: "key" },
      },
    })
    rooms.removeIfEmpty("ABC123")
    expect(rooms.size).toBe(1)
  })

  it("keeps independent workspace relays in one room", () => {
    const rooms = new RelayRooms()
    const room = rooms.get("ABC123")
    const relay = {
      name: "Laptop",
      hostname: "devbox",
      platform: "linux",
      arch: "x64",
      workspace: "/work/app",
    }
    room.relays.set("relay-1", { socket: {} as WebSocket, relay: { ...relay, id: "relay-1" } })
    room.relays.set("relay-2", { socket: {} as WebSocket, relay: { ...relay, id: "relay-2", workspace: "/work/docs" } })

    rooms.removeIfEmpty("ABC123")

    expect(room.relays.size).toBe(2)
    expect(rooms.size).toBe(1)
  })
})
