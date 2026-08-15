import type { EcPublicJwk, PairingBundle } from "@remotty/protocol"
import { describe, expect, it } from "vitest"
import { canReuseIdentity, identityKeyFor, queueCacheWrite, type DeviceIdentity } from "../src/deviceStore"

const publicKey = (x: string): EcPublicJwk => ({ kty: "EC", crv: "P-256", x, y: "B".repeat(43) })
const bundle: PairingBundle = {
  version: 2,
  brokerUrl: "wss://broker.example/ws",
  roomToken: "R".repeat(43),
  inviteId: "invite",
  inviteSecret: "I".repeat(43),
  relayId: "R".repeat(43),
  relaySigningKey: publicKey("S".repeat(43)),
  relayEncryptionKey: publicKey("E".repeat(43)),
}
const identity: DeviceIdentity = {
  key: "opaque-current-marker",
  authorityRoom: identityKeyFor(bundle),
  authorityId: bundle.relayId,
  brokerUrl: bundle.brokerUrl,
  roomToken: bundle.roomToken,
  deviceId: "device",
  name: "Browser",
  signingPublicKey: publicKey("D".repeat(43)),
  signingPrivateKey: {},
  encryptionPublicKey: publicKey("C".repeat(43)),
  encryptionPrivateKey: {},
  relaySigningKey: bundle.relaySigningKey,
  relayEncryptionKey: bundle.relayEncryptionKey,
  enrolled: true,
}

describe("device identity reuse", () => {
  it("keys records by relay authority and room while keeping the current marker opaque", () => {
    expect(identityKeyFor(bundle)).toBe(`${bundle.relayId}:${bundle.roomToken}`)
    expect(identity.key).not.toContain(bundle.roomToken)
    expect(canReuseIdentity(identity, bundle)).toBe(true)
  })

  it("does not replace trusted relay keys", () => {
    expect(canReuseIdentity(identity, { ...bundle, relaySigningKey: publicKey("X".repeat(43)) })).toBe(false)
    expect(canReuseIdentity(identity, { ...bundle, roomToken: "Q".repeat(43) })).toBe(false)
  })

  it("serializes cache writes for the same resource key", async () => {
    const events: string[] = []
    let release!: () => void
    const first = queueCacheWrite("identity:relay:session:messages", async () => {
      events.push("first-start")
      await new Promise<void>((resolve) => { release = resolve })
      events.push("first-end")
    })
    const second = queueCacheWrite("identity:relay:session:messages", async () => { events.push("second") })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(events).toEqual(["first-start"])
    release()
    await Promise.all([first, second])
    expect(events).toEqual(["first-start", "first-end", "second"])
  })

  it("continues the keyed queue after a rejected write", async () => {
    const events: string[] = []
    const first = queueCacheWrite("identity:workspace:session:messages", async () => {
      events.push("first")
      throw new Error("quota")
    })
    const second = queueCacheWrite("identity:workspace:session:messages", async () => { events.push("second") })
    await expect(first).rejects.toThrow("quota")
    await expect(second).resolves.toBeUndefined()
    expect(events).toEqual(["first", "second"])
  })
})
