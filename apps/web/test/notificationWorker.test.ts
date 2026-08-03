import {
  generateEncryptionKeyPair,
  generateSigningKeyPair,
  openJsonPayload,
  sealJsonPayload,
  signingKeyFingerprint,
} from "@remotty/protocol"
import { webcrypto } from "node:crypto"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import { describe, expect, it } from "vitest"

const source = readFileSync(new URL("../public/notification-sw.js", import.meta.url), "utf8")

const workerCrypto = () => {
  const context = {
    atob,
    btoa,
    console,
    crypto: webcrypto,
    TextDecoder,
    TextEncoder,
    URL,
    clients: {},
    indexedDB: {},
    self: {
      addEventListener: () => undefined,
      location: { origin: "https://app.example" },
      registration: {},
    },
  } as Record<string, unknown>
  runInNewContext(`${source}\nglobalThis.workerCrypto = { verifyAndOpen, sealCommand, applicationUrl, notificationClickMode }`, context)
  return context.workerCrypto as {
    verifyAndOpen: (frame: unknown, identity: unknown) => Promise<unknown>
    sealCommand: (command: unknown, identity: unknown, relayId: string) => Promise<unknown>
    applicationUrl: (data: unknown) => URL
    notificationClickMode: (action: string) => "action" | "open"
  }
}

describe("notification service worker security boundary", () => {
  it("posts only an opaque frame for permission actions", () => {
    expect(source).toContain("body: JSON.stringify({ roomToken: identity.roomToken, frame })")
    expect(source).not.toContain("code: data.code")
    expect(source).not.toContain("brokerUrl: data.brokerUrl")
    expect(source).toContain("event.preventDefault?.()")
    expect(source).toContain("event.stopImmediatePropagation?.()")
    expect(source).toContain('typeof data.targetSessionId === "string" ? data.targetSessionId : data.sessionId')
    expect(source).toContain('icon: "/icon-192.png"')
    expect(source).toContain('badge: "/notification-badge.png"')
  })

  it("opens the source session for notification body clicks", () => {
    const worker = workerCrypto()
    expect(worker.notificationClickMode("once")).toBe("action")
    expect(worker.notificationClickMode("")).toBe("open")
    expect(worker.applicationUrl({ workspaceRelayId: "relay-1", sessionId: "session-1" }).href)
      .toBe("https://app.example/app?session=relay-1%3Asession-1")
  })

  it("verifies, decrypts, and rejects stale Push frames", () => {
    expect(source).toContain("crypto.subtle.verify")
    expect(source).toContain("crypto.subtle.decrypt")
    expect(source).toContain("MAX_FRAME_AGE_MS")
    expect(source).toContain("rememberMessage")
  })

  it("interoperates with relay frames and seals valid device commands", async () => {
    const [relaySigning, relayEncryption, deviceSigning, deviceEncryption] = await Promise.all([
      generateSigningKeyPair(),
      generateEncryptionKeyPair(),
      generateSigningKeyPair(),
      generateEncryptionKeyPair(),
    ])
    const deviceId = await signingKeyFingerprint(deviceSigning.publicKey)
    const identity = {
      deviceId,
      signingPrivateKey: deviceSigning.privateKey,
      encryptionPrivateKey: deviceEncryption.privateKey,
      relaySigningKey: relaySigning.publicKey,
      relayEncryptionKey: relayEncryption.publicKey,
    }
    const frame = await sealJsonPayload({
      type: "notification.show",
      title: "Private title",
      body: "Private body",
      tag: "permission-1",
      actions: [],
      data: { workspaceRelayId: "relay-1", sessionId: "session-1" },
    }, {
      channel: "push",
      sender: "relay-1",
      recipient: deviceId,
      messageId: crypto.randomUUID(),
      issuedAt: Date.now(),
      senderSigningPrivateKey: relaySigning.privateKey,
      senderEncryptionPrivateKey: relayEncryption.privateKey,
      recipientEncryptionPublicKey: deviceEncryption.publicKey,
    })
    const worker = workerCrypto()

    await expect(worker.verifyAndOpen(frame, identity)).resolves.toMatchObject({ title: "Private title" })
    const tamperedCiphertext = Buffer.from(frame.ciphertext, "base64url")
    tamperedCiphertext[0] ^= 1
    await expect(worker.verifyAndOpen({ ...frame, ciphertext: tamperedCiphertext.toString("base64url") }, identity)).rejects.toThrow()

    const command = { type: "permission.reply", requestId: "request-1", sessionId: "session-1", permissionId: "permission-1", response: "once" }
    const sealed = await worker.sealCommand(command, identity, "relay-1")
    await expect(openJsonPayload(sealed as never, {
      recipient: "relay-1",
      recipientEncryptionPrivateKey: relayEncryption.privateKey,
      senderEncryptionPublicKey: deviceEncryption.publicKey,
      senderSigningPublicKey: deviceSigning.publicKey,
    })).resolves.toEqual(command)
  })
})
