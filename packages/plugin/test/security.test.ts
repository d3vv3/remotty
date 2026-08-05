import {
  base64urlEncode,
  generateEncryptionKeyPair,
  generateSigningKeyPair,
  openJsonPayload,
  sealEnrollmentPayload,
  sealJsonPayload,
  signingKeyFingerprint,
} from "@remotty/protocol"
import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import type { RelayConfig } from "../src/config"
import {
  COMMAND_MAX_CLOCK_SKEW_MS,
  ENROLLMENT_MAX_AGE_MS,
  consumeEnrollment,
  commandChangesState,
  openCommandFrame,
  recordMessageId,
  validateEnrollmentFrame,
  workspaceRelayId,
  type DeviceEnrollment,
} from "../src/security"

const now = Date.parse("2026-08-03T10:00:00.000Z")

async function fixture() {
  const [relaySigning, relayEncryption, deviceSigning, deviceEncryption] = await Promise.all([
    generateSigningKeyPair(),
    generateEncryptionKeyPair(),
    generateSigningKeyPair(),
    generateEncryptionKeyPair(),
  ])
  const inviteSecret = base64urlEncode(new Uint8Array(32).fill(7))
  const deviceId = await signingKeyFingerprint(deviceSigning.publicKey)
  const config: RelayConfig = {
    version: 2,
    brokerUrl: "wss://broker.example/ws",
    roomToken: base64urlEncode(new Uint8Array(32).fill(8)),
    name: "relay",
    authorityId: base64urlEncode(new Uint8Array(32).fill(8)),
    relaySigningPublicKey: relaySigning.publicKey,
    relaySigningPrivateKey: relaySigning.privateKey,
    relayEncryptionPublicKey: relayEncryption.publicKey,
    relayEncryptionPrivateKey: relayEncryption.privateKey,
    invites: [{
      id: "invite-1",
      secretHash: createHash("sha256").update(inviteSecret).digest("base64url"),
      createdAt: new Date(now - 60_000).toISOString(),
      expiresAt: new Date(now + 60_000).toISOString(),
    }],
    devices: [],
  }
  const enrollment: DeviceEnrollment = {
    type: "device.enroll",
    inviteId: "invite-1",
    inviteSecret,
    device: {
      id: deviceId,
      name: "phone",
      signingPublicKey: deviceSigning.publicKey,
      encryptionPublicKey: deviceEncryption.publicKey,
    },
  }
  const enrollmentFrame = () => sealEnrollmentPayload(enrollment, {
    sender: deviceId,
    recipient: "*",
    messageId: "enroll-1",
    issuedAt: now,
    signingPrivateKey: deviceSigning.privateKey,
    senderEncryptionPrivateKey: deviceEncryption.privateKey,
    senderEncryptionPublicKey: deviceEncryption.publicKey,
    recipientEncryptionPublicKey: relayEncryption.publicKey,
  })
  return { config, enrollment, enrollmentFrame, relaySigning, relayEncryption, deviceSigning, deviceEncryption, deviceId }
}

describe("relay v2 security", () => {
  it("derives workspace- and process-specific relay ids", () => {
    expect(workspaceRelayId("authority", "host", "/one")).toBe(workspaceRelayId("authority", "host", "/one"))
    expect(workspaceRelayId("authority", "host", "/one")).not.toBe(workspaceRelayId("authority", "host", "/two"))
    expect(workspaceRelayId("authority", "host", "/one", "instance-1"))
      .not.toBe(workspaceRelayId("authority", "host", "/one", "instance-2"))
  })

  it("persists replay protection only for state-changing commands", () => {
    expect(commandChangesState({ type: "session.messages", requestId: "r", sessionId: "s" })).toBe(false)
    expect(commandChangesState({ type: "session.prompt", requestId: "r", sessionId: "s", text: "continue" })).toBe(true)
    expect(commandChangesState({ type: "permission.reply", requestId: "r", sessionId: "s", permissionId: "p", response: "always" })).toBe(true)
  })

  it("validates and consumes a self-signed enrollment without storing its secret", async () => {
    const data = await fixture()
    const enrollment = await validateEnrollmentFrame(await data.enrollmentFrame(), data.config, now)
    const result = consumeEnrollment(data.config, enrollment, new Date(now))
    expect(result.device.id).toBe(data.deviceId)
    expect(result.config.invites[0]?.usedAt).toBe(new Date(now).toISOString())
    expect(JSON.stringify(result.config)).not.toContain(data.enrollment.inviteSecret)
  })

  it("makes an identical enrollment idempotent after invite consumption", async () => {
    const data = await fixture()
    const first = consumeEnrollment(data.config, data.enrollment, new Date(now))
    const second = consumeEnrollment(first.config, data.enrollment, new Date(now + 1))
    expect(second.idempotent).toBe(true)
    expect(second.config.devices).toHaveLength(1)
  })

  it("rejects wrong and expired invitations", async () => {
    const data = await fixture()
    expect(() => consumeEnrollment(data.config, { ...data.enrollment, inviteSecret: "wrong" }, new Date(now))).toThrow("Invalid invitation")
    expect(() => consumeEnrollment(data.config, data.enrollment, new Date(now + 60_001))).toThrow("expired")
  })

  it("rejects stale enrollment frames", async () => {
    const data = await fixture()
    await expect(validateEnrollmentFrame(await data.enrollmentFrame(), data.config, now + ENROLLMENT_MAX_AGE_MS + 1)).rejects.toThrow("not recent")
  })

  it("binds enrollment identity and encryption keys to the signed frame", async () => {
    const data = await fixture()
    const wrongIdentity = { ...data.enrollment, device: { ...data.enrollment.device, id: "another-device" } }
    const identityFrame = await sealEnrollmentPayload(wrongIdentity, {
      sender: "another-device",
      recipient: "*",
      messageId: "enroll-wrong-id",
      issuedAt: now,
      signingPrivateKey: data.deviceSigning.privateKey,
      senderEncryptionPrivateKey: data.deviceEncryption.privateKey,
      senderEncryptionPublicKey: data.deviceEncryption.publicKey,
      recipientEncryptionPublicKey: data.relayEncryption.publicKey,
    })
    await expect(validateEnrollmentFrame(identityFrame, data.config, now)).rejects.toThrow("signing key")

    const otherEncryption = await generateEncryptionKeyPair()
    const wrongEncryption = {
      ...data.enrollment,
      device: { ...data.enrollment.device, encryptionPublicKey: otherEncryption.publicKey },
    }
    const encryptionFrame = await sealEnrollmentPayload(wrongEncryption, {
      sender: data.deviceId,
      recipient: "*",
      messageId: "enroll-wrong-key",
      issuedAt: now,
      signingPrivateKey: data.deviceSigning.privateKey,
      senderEncryptionPrivateKey: data.deviceEncryption.privateKey,
      senderEncryptionPublicKey: data.deviceEncryption.publicKey,
      recipientEncryptionPublicKey: data.relayEncryption.publicKey,
    })
    await expect(validateEnrollmentFrame(encryptionFrame, data.config, now)).rejects.toThrow("encryption key")
  })

  it("rejects revoked devices and duplicate message ids", async () => {
    const data = await fixture()
    const enrolled = consumeEnrollment(data.config, data.enrollment, new Date(now)).config
    const recorded = recordMessageId(enrolled, data.deviceId, "message-1", now, now)
    expect(() => recordMessageId(recorded, data.deviceId, "message-1", now, now)).toThrow("Duplicate")
    const revoked = { ...recorded, devices: recorded.devices.map((device) => ({ ...device, revokedAt: new Date(now).toISOString() })) }
    expect(() => recordMessageId(revoked, data.deviceId, "message-2")).toThrow("not active")
  })

  it("retains every state-changing message for the complete clock window", async () => {
    const data = await fixture()
    let config = consumeEnrollment(data.config, data.enrollment, new Date(now)).config
    for (let index = 0; index < 300; index++) {
      config = recordMessageId(config, data.deviceId, `message-${index}`, now, now)
    }
    expect(config.devices[0]?.recentMessages).toHaveLength(300)
    expect(() => recordMessageId(config, data.deviceId, "message-0", now, now)).toThrow("Duplicate")
    const pruned = recordMessageId(config, data.deviceId, "new", now + COMMAND_MAX_CLOCK_SKEW_MS + 1, now + COMMAND_MAX_CLOCK_SKEW_MS + 1)
    expect(pruned.devices[0]?.recentMessages).toEqual([{ id: "new", issuedAt: now + COMMAND_MAX_CLOCK_SKEW_MS + 1 }])
  })

  it("decrypts commands and encrypts relay responses end to end", async () => {
    const data = await fixture()
    const enrolled = consumeEnrollment(data.config, data.enrollment, new Date(now)).config
    const relayId = workspaceRelayId(enrolled.authorityId, "host", "/workspace")
    const commandFrame = await sealJsonPayload(
      { type: "session.abort", requestId: "request-1", sessionId: "session-1" },
      {
        channel: "data",
        sender: data.deviceId,
        recipient: relayId,
        messageId: "command-1",
        issuedAt: now,
        senderSigningPrivateKey: data.deviceSigning.privateKey,
        senderEncryptionPrivateKey: data.deviceEncryption.privateKey,
        recipientEncryptionPublicKey: data.relayEncryption.publicKey,
      },
    )
    const opened = await openCommandFrame(commandFrame, enrolled, relayId, now)
    expect(opened.command).toMatchObject({ type: "session.abort", requestId: "request-1" })

    const revoked = {
      ...enrolled,
      devices: enrolled.devices.map((device) => ({ ...device, revokedAt: new Date(now).toISOString() })),
    }
    await expect(openCommandFrame(commandFrame, revoked, relayId, now)).rejects.toMatchObject({
      name: "DeviceRevokedError",
      device: { id: data.deviceId },
    })

    const response = await sealJsonPayload(
      { type: "rpc.result", requestId: "request-1", result: true },
      {
        channel: "data",
        sender: relayId,
        recipient: data.deviceId,
        messageId: "response-1",
        issuedAt: now,
        senderSigningPrivateKey: data.relaySigning.privateKey,
        senderEncryptionPrivateKey: data.relayEncryption.privateKey,
        recipientEncryptionPublicKey: data.deviceEncryption.publicKey,
      },
    )
    await expect(openJsonPayload(response, {
      recipient: data.deviceId,
      recipientEncryptionPrivateKey: data.deviceEncryption.privateKey,
      senderEncryptionPublicKey: data.relayEncryption.publicKey,
      senderSigningPublicKey: data.relaySigning.publicKey,
    })).resolves.toMatchObject({ type: "rpc.result", requestId: "request-1", result: true })
  })

  it("rejects command timestamps outside the clock window", async () => {
    const data = await fixture()
    const enrolled = consumeEnrollment(data.config, data.enrollment, new Date(now)).config
    const relayId = workspaceRelayId(enrolled.authorityId, "host", "/workspace")
    const frame = await sealJsonPayload({ type: "snapshot.request", requestId: "request-1" }, {
      channel: "data",
      sender: data.deviceId,
      recipient: relayId,
      messageId: "command-1",
      issuedAt: now - COMMAND_MAX_CLOCK_SKEW_MS - 1,
      senderSigningPrivateKey: data.deviceSigning.privateKey,
      senderEncryptionPrivateKey: data.deviceEncryption.privateKey,
      recipientEncryptionPublicKey: data.relayEncryption.publicKey,
    })
    await expect(openCommandFrame(frame, enrolled, relayId, now)).rejects.toThrow("timestamp")
  })
})
