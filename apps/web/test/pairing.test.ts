import {
  base64urlEncode,
  encodePairingBundle,
  generateEncryptionKeyPair,
  generateSigningKeyPair,
  type PairingBundle,
} from "@remotty/protocol"
import { beforeAll, describe, expect, it } from "vitest"
import { pairingBundleFrom, routeForEnrollment, routeForStoredIdentity } from "../src/features/pairing/pairing"

let bundle: PairingBundle
let token: string

beforeAll(async () => {
  const [signing, encryption] = await Promise.all([generateSigningKeyPair(), generateEncryptionKeyPair()])
  bundle = {
    version: 2,
    brokerUrl: "wss://broker.example.test/ws",
    roomToken: base64urlEncode(new Uint8Array(32).fill(1)),
    inviteId: "invite-1",
    inviteSecret: base64urlEncode(new Uint8Array(32).fill(2)),
    relayId: base64urlEncode(new Uint8Array(32).fill(1)),
    relaySigningKey: signing.publicKey,
    relayEncryptionKey: encryption.publicKey,
  }
  token = encodePairingBundle(bundle)
})

describe("pairingBundleFrom", () => {
  it("accepts a raw v2 token", () => {
    expect(pairingBundleFrom(token)).toEqual(bundle)
  })

  it("reads a v2 token only from a URL fragment", () => {
    expect(pairingBundleFrom(`https://remotty.example/pair#${token}`)).toEqual(bundle)
  })

  it("rejects legacy and ambiguous credential locations", () => {
    expect(pairingBundleFrom("A".repeat(43))).toBeUndefined()
    expect(pairingBundleFrom(`https://remotty.example/pair?code=${encodeURIComponent(token)}`)).toBeUndefined()
    expect(pairingBundleFrom(`https://remotty.example/pair?source=mail#${token}`)).toBeUndefined()
    expect(pairingBundleFrom("https://example.com/#unrelated")).toBeUndefined()
  })
})

describe("routeForEnrollment", () => {
  it("stays on pairing until enrollment succeeds", () => {
    expect(routeForEnrollment(undefined)).toBeUndefined()
    expect(routeForEnrollment(false)).toBe("/pair")
    expect(routeForEnrollment(true)).toBe("/app")
  })
})

describe("routeForStoredIdentity", () => {
  it("opens the app from home only for an enrolled identity", () => {
    expect(routeForStoredIdentity("/", true)).toBe("/app")
    expect(routeForStoredIdentity("/", false)).toBe("/")
    expect(routeForStoredIdentity("/privacy", true)).toBe("/privacy")
    expect(routeForStoredIdentity("/pair", true)).toBe("/pair")
  })
})
