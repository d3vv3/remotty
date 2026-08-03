import { decodePairingBundle, generateEncryptionKeyPair, generateSigningKeyPair, type PairingBundle } from "@remotty/protocol"
import { describe, expect, it } from "vitest"
import { DEFAULT_BROKER_URL, pairingUrl } from "../src/pairing"

const bundle = async (brokerUrl: string): Promise<PairingBundle> => {
  const [signing, encryption] = await Promise.all([generateSigningKeyPair(), generateEncryptionKeyPair()])
  return {
    version: 2,
    brokerUrl,
    roomToken: "a".repeat(43),
    inviteId: "invite-1",
    inviteSecret: "b".repeat(43),
    relayId: "a".repeat(43),
    relaySigningKey: signing.publicKey,
    relayEncryptionKey: encryption.publicKey,
  }
}

describe("pairingUrl", () => {
  it("uses the hosted broker by default", () => {
    expect(DEFAULT_BROKER_URL).toBe("wss://remotty.devve.space/ws")
  })

  it("puts the v2 bundle in the fragment, never the search string", async () => {
    const pairing = await bundle("wss://remotty.devve.space/ws")
    const url = new URL(pairingUrl(pairing))

    expect(url.origin + url.pathname).toBe("https://remotty.devve.space/pair")
    expect(url.search).toBe("")
    expect(url.hash).not.toBe("")
    expect(decodePairingBundle(url.href)).toEqual(pairing)
  })

  it("uses the Vite port for local development", async () => {
    const url = new URL(pairingUrl(await bundle("ws://localhost:8787/ws")))
    expect(url.origin + url.pathname).toBe("http://localhost:5173/pair")
  })

  it("accepts an explicit app URL and clears its search", async () => {
    const url = new URL(pairingUrl(await bundle("wss://broker.example/ws"), "https://app.example/base?secret=old"))
    expect(url.origin + url.pathname).toBe("https://app.example/pair")
    expect(url.search).toBe("")
  })

  it("rejects insecure remote application origins", async () => {
    const pairing = await bundle("wss://broker.example/ws")
    expect(() => pairingUrl(pairing, "http://app.example")).toThrow("HTTPS")
  })
})
