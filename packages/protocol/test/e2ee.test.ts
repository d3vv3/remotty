import { describe, expect, it } from "vitest"
import {
  base64urlDecode,
  base64urlEncode,
  canonicalFrameSigningInput,
  canonicalizeJson,
  decodePairingBundle,
  encodePairingBundle,
  generateEncryptionKeyPair,
  generateSigningKeyPair,
  openEnrollmentPayload,
  openJsonPayload,
  sealEnrollmentPayload,
  sealJsonPayload,
  signCanonicalJson,
  signingKeyFingerprint,
  transportProofPayload,
  verifyCanonicalJson,
  type E2eeFrame,
  type PairingBundle,
} from "../src/index"

async function devices() {
  const [aliceSigning, aliceEncryption, bobSigning, bobEncryption] = await Promise.all([
    generateSigningKeyPair(),
    generateEncryptionKeyPair(),
    generateSigningKeyPair(),
    generateEncryptionKeyPair(),
  ])
  return { aliceSigning, aliceEncryption, bobSigning, bobEncryption }
}

describe("E2EE protocol v2", () => {
  it("round-trips browser-compatible ECDH, ECDSA, and AES-GCM", async () => {
    const keys = await devices()
    const frame = await sealJsonPayload(
      { command: "session.abort", nested: { sessionId: "session-1" } },
      {
        channel: "data",
        sender: "alice",
        recipient: "bob",
        messageId: "message-1",
        issuedAt: 1_750_000_000_000,
        senderSigningPrivateKey: keys.aliceSigning.privateKey,
        senderEncryptionPrivateKey: keys.aliceEncryption.privateKey,
        recipientEncryptionPublicKey: keys.bobEncryption.publicKey,
      },
    )

    await expect(
      openJsonPayload(frame, {
        recipient: "bob",
        recipientEncryptionPrivateKey: keys.bobEncryption.privateKey,
        senderEncryptionPublicKey: keys.aliceEncryption.publicKey,
        senderSigningPublicKey: keys.aliceSigning.publicKey,
      }),
    ).resolves.toEqual({ command: "session.abort", nested: { sessionId: "session-1" } })
  })

  it("rejects decryption with the wrong recipient key", async () => {
    const keys = await devices()
    const frame = await sealJsonPayload(
      { value: 1 },
      {
        channel: "push",
        sender: "alice",
        recipient: "bob",
        messageId: "message-2",
        issuedAt: 1,
        senderSigningPrivateKey: keys.aliceSigning.privateKey,
        senderEncryptionPrivateKey: keys.aliceEncryption.privateKey,
        recipientEncryptionPublicKey: keys.bobEncryption.publicKey,
      },
    )

    await expect(
      openJsonPayload(frame, {
        recipient: "bob",
        recipientEncryptionPrivateKey: keys.aliceEncryption.privateKey,
        senderEncryptionPublicKey: keys.aliceEncryption.publicKey,
        senderSigningPublicKey: keys.aliceSigning.publicKey,
      }),
    ).rejects.toThrow()
  })

  it.each(["ciphertext", "issuedAt"] as const)("rejects %s tampering", async (field) => {
    const keys = await devices()
    const frame = await sealJsonPayload(
      { value: 1 },
      {
        channel: "data",
        sender: "alice",
        recipient: "bob",
        messageId: "message-3",
        issuedAt: 10,
        senderSigningPrivateKey: keys.aliceSigning.privateKey,
        senderEncryptionPrivateKey: keys.aliceEncryption.privateKey,
        recipientEncryptionPublicKey: keys.bobEncryption.publicKey,
      },
    )
    const tampered: E2eeFrame = {
      ...frame,
      [field]: field === "issuedAt" ? frame.issuedAt + 1 : `${frame.ciphertext.slice(0, -1)}${frame.ciphertext.endsWith("A") ? "B" : "A"}`,
    }

    await expect(
      openJsonPayload(tampered, {
        recipient: "bob",
        recipientEncryptionPrivateKey: keys.bobEncryption.privateKey,
        senderEncryptionPublicKey: keys.aliceEncryption.publicKey,
        senderSigningPublicKey: keys.aliceSigning.publicKey,
      }),
    ).rejects.toThrow()
  })

  it("rejects signature tampering", async () => {
    const keys = await devices()
    const frame = await sealJsonPayload(
      { value: 1 },
      {
        channel: "data",
        sender: "alice",
        recipient: "bob",
        messageId: "message-4",
        issuedAt: 10,
        senderSigningPrivateKey: keys.aliceSigning.privateKey,
        senderEncryptionPrivateKey: keys.aliceEncryption.privateKey,
        recipientEncryptionPublicKey: keys.bobEncryption.publicKey,
      },
    )
    const signature = base64urlDecode(frame.signature)
    signature[0] = (signature[0] ?? 0) ^ 1

    await expect(
      openJsonPayload(
        { ...frame, signature: base64urlEncode(signature) },
        {
          recipient: "bob",
          recipientEncryptionPrivateKey: keys.bobEncryption.privateKey,
          senderEncryptionPublicKey: keys.aliceEncryption.publicKey,
          senderSigningPublicKey: keys.aliceSigning.publicKey,
        },
      ),
    ).rejects.toThrow("signature")
  })

  it("encrypts enrollment to the relay and verifies the decrypted device key", async () => {
    const signing = await generateSigningKeyPair()
    const [deviceEncryption, relayEncryption] = await Promise.all([generateEncryptionKeyPair(), generateEncryptionKeyPair()])
    const inviteSecret = base64urlEncode(crypto.getRandomValues(new Uint8Array(32)))
    const payload = { deviceId: "new-device", inviteSecret, signingPublicKey: signing.publicKey }
    const frame = await sealEnrollmentPayload(payload, {
      sender: "new-device",
      recipient: "relay-1",
      messageId: "enrollment-1",
      issuedAt: 20,
      signingPrivateKey: signing.privateKey,
      senderEncryptionPrivateKey: deviceEncryption.privateKey,
      senderEncryptionPublicKey: deviceEncryption.publicKey,
      recipientEncryptionPublicKey: relayEncryption.publicKey,
    })

    await expect(
      openEnrollmentPayload<typeof payload>(frame, {
        recipient: "relay-1",
        recipientEncryptionPrivateKey: relayEncryption.privateKey,
        signingPublicKey: (body) => body.signingPublicKey,
      }),
    ).resolves.toEqual(payload)
  })

  it("encodes and decodes pairing bundles and URL fragments", async () => {
    const [signing, encryption] = await Promise.all([generateSigningKeyPair(), generateEncryptionKeyPair()])
    const bundle: PairingBundle = {
      version: 2,
      brokerUrl: "wss://broker.example.test/ws",
      roomToken: base64urlEncode(new Uint8Array(32).fill(1)),
      inviteId: "invite-1",
      inviteSecret: base64urlEncode(new Uint8Array(32).fill(2)),
      relayId: base64urlEncode(new Uint8Array(32).fill(1)),
      relaySigningKey: signing.publicKey,
      relayEncryptionKey: encryption.publicKey,
    }
    const token = encodePairingBundle(bundle)

    expect(token.startsWith("remotty:v2:")).toBe(true)
    expect(token.length).toBeLessThan(500)
    expect(decodePairingBundle(token)).toEqual(bundle)
    expect(decodePairingBundle(`https://app.example.test/pair#${token}`)).toEqual(bundle)

    const legacyToken = `remotty:v2:${base64urlEncode(new TextEncoder().encode(JSON.stringify(bundle)))}`
    expect(decodePairingBundle(legacyToken)).toEqual(bundle)
  })

  it("rejects insecure remote broker URLs", async () => {
    const [signing, encryption] = await Promise.all([generateSigningKeyPair(), generateEncryptionKeyPair()])
    const common = {
      version: 2 as const,
      roomToken: base64urlEncode(new Uint8Array(32).fill(1)),
      inviteId: "invite-1",
      inviteSecret: base64urlEncode(new Uint8Array(32).fill(2)),
      relayId: base64urlEncode(new Uint8Array(32).fill(1)),
      relaySigningKey: signing.publicKey,
      relayEncryptionKey: encryption.publicKey,
    }
    expect(() => encodePairingBundle({ ...common, brokerUrl: "ws://broker.example.test/ws" })).toThrow()
    expect(() => encodePairingBundle({ ...common, brokerUrl: "wss://user@broker.example.test/ws" })).toThrow()
    expect(() => encodePairingBundle({ ...common, brokerUrl: "wss://broker.example.test/other" })).toThrow()
    expect(() => encodePairingBundle({ ...common, brokerUrl: "ws://127.0.0.1:8787/ws" })).not.toThrow()
  })

  it("produces deterministic canonicalization, signing input, and fingerprints", async () => {
    const signing = await generateSigningKeyPair()
    expect(canonicalizeJson({ z: 1, a: { y: true, x: "value" } })).toBe('{"a":{"x":"value","y":true},"z":1}')
    await expect(signingKeyFingerprint(signing.publicKey)).resolves.toBe(await signingKeyFingerprint({ ...signing.publicKey }))

    const common = {
      type: "e2ee.frame" as const,
      version: 2 as const,
      channel: "data" as const,
      sender: "alice",
      recipient: "bob",
      messageId: "message-5",
      issuedAt: 30,
      nonce: base64urlEncode(new Uint8Array(12)),
      ciphertext: "AQID",
    }
    expect(base64urlEncode(canonicalFrameSigningInput(common))).toBe(base64urlEncode(canonicalFrameSigningInput({ ...common })))
  })

  it("binds transport identity proofs to role, identity, and room", async () => {
    const signing = await generateSigningKeyPair()
    const room = await signingKeyFingerprint(signing.publicKey)
    const proof = transportProofPayload("relay", "workspace-1", room, "challenge-1")
    const signature = await signCanonicalJson(proof, signing.privateKey)
    await expect(verifyCanonicalJson(proof, signature, signing.publicKey)).resolves.toBe(true)
    await expect(verifyCanonicalJson(transportProofPayload("relay", "workspace-2", room, "challenge-1"), signature, signing.publicKey)).resolves.toBe(false)
    await expect(verifyCanonicalJson(transportProofPayload("relay", "workspace-1", room, "challenge-2"), signature, signing.publicKey)).resolves.toBe(false)
  })
})
