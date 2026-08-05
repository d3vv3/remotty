import {
  clientCommandSchema,
  ecPublicJwkSchema,
  openEnrollmentPayload,
  openJsonPayload,
  signingKeyFingerprint,
  type ClientCommand,
  type E2eeFrame,
  type EcPublicJwk,
} from "@remotty/protocol"
import { createHash, timingSafeEqual } from "node:crypto"
import {
  updateConfig,
  type DeviceRecord,
  type RelayConfig,
} from "./config.js"

export const ENROLLMENT_MAX_AGE_MS = 5 * 60 * 1_000
export const COMMAND_MAX_CLOCK_SKEW_MS = 2 * 60 * 1_000

export type DeviceEnrollment = {
  type: "device.enroll"
  inviteId: string
  inviteSecret: string
  device: {
    id: string
    name: string
    signingPublicKey: EcPublicJwk
    encryptionPublicKey: EcPublicJwk
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const hasExactKeys = (value: Record<string, unknown>, keys: string[]) => {
  const actual = Object.keys(value).sort()
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index])
}

const parseEnrollmentPayload = (value: unknown): DeviceEnrollment => {
  if (!isObject(value) || !hasExactKeys(value, ["type", "inviteId", "inviteSecret", "device"])) {
    throw new Error("Invalid device enrollment payload")
  }
  if (value.type !== "device.enroll" || typeof value.inviteId !== "string" || !value.inviteId ||
    typeof value.inviteSecret !== "string" || !value.inviteSecret || !isObject(value.device) ||
    !hasExactKeys(value.device, ["id", "name", "signingPublicKey", "encryptionPublicKey"])) {
    throw new Error("Invalid device enrollment payload")
  }
  const device = value.device
  const signingPublicKey = ecPublicJwkSchema.safeParse(device.signingPublicKey)
  const encryptionPublicKey = ecPublicJwkSchema.safeParse(device.encryptionPublicKey)
  if (typeof device.id !== "string" || !device.id || typeof device.name !== "string" || !device.name.trim() ||
    !signingPublicKey.success || !encryptionPublicKey.success) {
    throw new Error("Invalid device enrollment payload")
  }
  return {
    type: "device.enroll",
    inviteId: value.inviteId,
    inviteSecret: value.inviteSecret,
    device: {
      id: device.id,
      name: device.name.trim(),
      signingPublicKey: signingPublicKey.data,
      encryptionPublicKey: encryptionPublicKey.data,
    },
  }
}

const samePublicKey = (left: EcPublicJwk, right: EcPublicJwk) =>
  left.kty === right.kty && left.crv === right.crv && left.x === right.x && left.y === right.y

const sameDevice = (record: DeviceRecord, enrollment: DeviceEnrollment["device"]) =>
  record.id === enrollment.id &&
  record.name === enrollment.name &&
  samePublicKey(record.signingPublicKey, enrollment.signingPublicKey) &&
  samePublicKey(record.encryptionPublicKey, enrollment.encryptionPublicKey)

const secretMatches = (secret: string, expectedHash: string) => {
  const actual = createHash("sha256").update(secret).digest()
  let expected: Buffer
  try {
    expected = Buffer.from(expectedHash, "base64url")
  } catch {
    return false
  }
  return expected.length === actual.length && timingSafeEqual(actual, expected)
}

export const workspaceRelayId = (authorityId: string, host: string, directory: string, instanceId?: string) => {
  const hash = createHash("sha256")
    .update(authorityId)
    .update("\0")
    .update(host)
    .update("\0")
    .update(directory)
  if (instanceId) hash.update("\0").update(instanceId)
  return hash.digest("base64url")
}

export const commandChangesState = (command: ClientCommand) =>
  ["session.prompt", "session.abort", "permission.reply", "question.reply", "question.reject"].includes(command.type)

export async function validateEnrollmentFrame(
  frame: E2eeFrame,
  config: RelayConfig,
  now = Date.now(),
): Promise<DeviceEnrollment> {
  if (frame.channel !== "enroll" || frame.recipient !== "*") throw new Error("Invalid enrollment route")
  if (Math.abs(now - frame.issuedAt) > ENROLLMENT_MAX_AGE_MS) throw new Error("Enrollment frame is not recent")
  if (!frame.enrollmentKey) throw new Error("Enrollment frame is missing its encryption key")

  const payload = await openEnrollmentPayload<unknown>(frame, {
    recipient: "*",
    recipientEncryptionPrivateKey: config.relayEncryptionPrivateKey,
    signingPublicKey: (decrypted) => parseEnrollmentPayload(decrypted).device.signingPublicKey,
  }).then(parseEnrollmentPayload)

  if (payload.device.id !== frame.sender) throw new Error("Enrollment sender does not match device id")
  if (payload.device.id !== await signingKeyFingerprint(payload.device.signingPublicKey)) {
    throw new Error("Device id does not match signing key")
  }
  if (!samePublicKey(payload.device.encryptionPublicKey, frame.enrollmentKey)) {
    throw new Error("Enrollment encryption key does not match payload")
  }
  return payload
}

export function consumeEnrollment(
  config: RelayConfig,
  enrollment: DeviceEnrollment,
  now = new Date(),
): { config: RelayConfig; device: DeviceRecord; idempotent: boolean } {
  const invite = config.invites.find((candidate) => candidate.id === enrollment.inviteId)
  if (!invite || !secretMatches(enrollment.inviteSecret, invite.secretHash)) throw new Error("Invalid invitation")
  if (Date.parse(invite.expiresAt) <= now.getTime()) throw new Error("Invitation has expired")

  const existing = config.devices.find((candidate) => candidate.id === enrollment.device.id)
  if (invite.usedAt) {
    if (existing && !existing.revokedAt && sameDevice(existing, enrollment.device)) {
      return { config, device: existing, idempotent: true }
    }
    throw new Error("Invitation has already been used")
  }
  if (existing) throw new Error(existing.revokedAt ? "Device has been revoked" : "Device id is already enrolled")

  const usedAt = now.toISOString()
  const device: DeviceRecord = {
    ...enrollment.device,
    enrolledAt: usedAt,
    recentMessages: [],
  }
  return {
    config: {
      ...config,
      invites: config.invites.map((candidate) => candidate.id === invite.id ? { ...candidate, usedAt } : candidate),
      devices: [...config.devices, device],
    },
    device,
    idempotent: false,
  }
}

export function recordMessageId(
  config: RelayConfig,
  deviceId: string,
  messageId: string,
  issuedAt = Date.now(),
  now = Date.now(),
): RelayConfig {
  const device = config.devices.find((candidate) => candidate.id === deviceId)
  if (!device || device.revokedAt) throw new Error("Device is not active")
  const recentMessages = device.recentMessages.filter((message) => message.issuedAt >= now - COMMAND_MAX_CLOCK_SKEW_MS)
  if (recentMessages.some((message) => message.id === messageId)) throw new Error("Duplicate message id")
  return {
    ...config,
    devices: config.devices.map((candidate) => candidate.id === deviceId
      ? { ...candidate, recentMessages: [...recentMessages, { id: messageId, issuedAt }] }
      : candidate),
  }
}

export class DeviceRevokedError extends Error {
  constructor(readonly device: DeviceRecord) {
    super("Device has been revoked")
    this.name = "DeviceRevokedError"
  }
}

export async function openCommandFrame(
  frame: E2eeFrame,
  config: RelayConfig,
  relayId: string,
  now = Date.now(),
): Promise<{ command: ClientCommand; device: DeviceRecord }> {
  if (frame.channel !== "data" || frame.recipient !== relayId) throw new Error("Invalid command route")
  if (Math.abs(now - frame.issuedAt) > COMMAND_MAX_CLOCK_SKEW_MS) throw new Error("Command timestamp is outside the allowed window")
  const device = config.devices.find((candidate) => candidate.id === frame.sender)
  if (!device) throw new Error("Device is not active")
  const command = clientCommandSchema.parse(await openJsonPayload<unknown>(frame, {
    recipient: relayId,
    recipientEncryptionPrivateKey: config.relayEncryptionPrivateKey,
    senderEncryptionPublicKey: device.encryptionPublicKey,
    senderSigningPublicKey: device.signingPublicKey,
  }))
  if (device.revokedAt) throw new DeviceRevokedError(device)
  return { command, device }
}

export const updateV2ConfigLocked = (update: (config: RelayConfig) => RelayConfig | Promise<RelayConfig>) =>
  updateConfig(async (current) => {
    if (current?.version !== 2) throw new Error("Relay v2 configuration is unavailable")
    return update(current)
  })
