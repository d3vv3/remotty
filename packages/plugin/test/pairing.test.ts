import { describe, expect, it } from "vitest"
import { pairingUrl } from "../src/pairing"

describe("pairingUrl", () => {
  it("builds a production pairing deep link", () => {
    expect(pairingUrl("wss://remotty.devve.space/ws", "secret-key")).toBe(
      "https://remotty.devve.space/?code=secret-key",
    )
  })

  it("uses the Vite port for local development", () => {
    expect(pairingUrl("ws://localhost:8787/ws", "secret-key")).toBe(
      "http://localhost:5173/?code=secret-key",
    )
  })

  it("accepts an explicit app URL", () => {
    expect(pairingUrl("wss://broker.example/ws", "secret-key", "https://app.example")).toBe(
      "https://app.example/?code=secret-key",
    )
  })
})
