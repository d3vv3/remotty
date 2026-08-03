import { describe, expect, it } from "vitest"
import { RelayRooms } from "../src/rooms"

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
})
