import { z } from "zod"

const base64urlPattern = /^[A-Za-z0-9_-]+$/
const base64url32BytesSchema = z.string().length(43).regex(base64urlPattern)

export const base64urlSchema = z.string().min(1).regex(base64urlPattern)
export const p256CoordinateSchema = base64url32BytesSchema

export const ecPublicJwkSchema = z
  .object({
    kty: z.literal("EC"),
    crv: z.literal("P-256"),
    x: p256CoordinateSchema,
    y: p256CoordinateSchema,
    key_ops: z.array(z.string()).optional(),
    ext: z.boolean().optional(),
    alg: z.string().optional(),
    use: z.string().optional(),
  })
  .strict()
export type EcPublicJwk = z.infer<typeof ecPublicJwkSchema>

const isLoopbackHost = (hostname: string) =>
  hostname === "localhost" || hostname === "::1" || /^127(?:\.\d{1,3}){3}$/.test(hostname)

export const isSecureBrokerUrl = (value: string) => {
  try {
    const url = new URL(value)
    return !url.username && !url.password && !url.search && !url.hash && url.pathname === "/ws" &&
      (url.protocol === "wss:" || (url.protocol === "ws:" && isLoopbackHost(url.hostname)))
  } catch {
    return false
  }
}

export const isSecureAppUrl = (value: string) => {
  try {
    const url = new URL(value)
    return !url.username && !url.password &&
      (url.protocol === "https:" || (url.protocol === "http:" && isLoopbackHost(url.hostname)))
  } catch {
    return false
  }
}

export const pairingBundleSchema = z
  .object({
    version: z.literal(2),
    brokerUrl: z.url().refine(isSecureBrokerUrl, "Broker URL must use WSS outside loopback"),
    roomToken: base64url32BytesSchema,
    inviteId: z.string().min(1),
    inviteSecret: base64url32BytesSchema,
    relayId: z.string().min(1),
    relaySigningKey: ecPublicJwkSchema,
    relayEncryptionKey: ecPublicJwkSchema,
  })
  .strict()
  .superRefine((bundle, context) => {
    if (bundle.roomToken !== bundle.relayId) {
      context.addIssue({ code: "custom", message: "Room token must match the relay authority" })
    }
  })
export type PairingBundle = z.infer<typeof pairingBundleSchema>

export const e2eeChannelSchema = z.enum(["data", "push", "enroll"])
export type E2eeChannel = z.infer<typeof e2eeChannelSchema>

export const e2eeFrameHeaderSchema = z
  .object({
    type: z.literal("e2ee.frame"),
    version: z.literal(2),
    channel: e2eeChannelSchema,
    sender: z.string().min(1),
    recipient: z.string().min(1),
    messageId: z.string().min(1),
    issuedAt: z.number().int().nonnegative(),
    nonce: z.string().length(16).regex(base64urlPattern),
    enrollmentKey: ecPublicJwkSchema.optional(),
  })
  .strict()
export type E2eeFrameHeader = z.infer<typeof e2eeFrameHeaderSchema>

export const e2eeFrameSchema = e2eeFrameHeaderSchema
  .extend({
    ciphertext: base64urlSchema,
    signature: z.string().length(86).regex(base64urlPattern),
  })
  .strict()
  .superRefine((frame, context) => {
    if (frame.channel === "enroll" && !frame.enrollmentKey) {
      context.addIssue({ code: "custom", message: "Enrollment frames require an encryption key" })
    }
    if (frame.channel !== "enroll" && frame.enrollmentKey) {
      context.addIssue({ code: "custom", message: "Only enrollment frames can include an enrollment key" })
    }
  })
export type E2eeFrame = z.infer<typeof e2eeFrameSchema>

export const brokerTransportHelloSchema = z.discriminatedUnion("role", [
  z
    .object({
      type: z.literal("transport.hello"),
      version: z.literal(2),
      role: z.literal("relay"),
      relayId: z.string().min(1),
      publicKey: ecPublicJwkSchema,
      signature: base64urlSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("transport.hello"),
      version: z.literal(2),
      role: z.literal("client"),
      deviceId: z.string().min(1),
      publicKey: ecPublicJwkSchema,
      signature: base64urlSchema,
    })
    .strict(),
])
export type BrokerTransportHello = z.infer<typeof brokerTransportHelloSchema>

export const brokerTransportControlSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("broker.challenge"),
      version: z.literal(2),
      nonce: base64urlSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("broker.ready"),
      version: z.literal(2),
      connectedRelayIds: z.array(z.string().min(1)),
    })
    .strict(),
  z
    .object({
      type: z.literal("broker.relay-status"),
      version: z.literal(2),
      relayId: z.string().min(1),
      connected: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal("broker.error"),
      version: z.literal(2),
      code: z.string().min(1),
      message: z.string().min(1),
    })
    .strict(),
])
export type BrokerTransportControl = z.infer<typeof brokerTransportControlSchema>

export const opaqueBrokerTransportSchema = z.union([
  brokerTransportHelloSchema,
  brokerTransportControlSchema,
  e2eeFrameSchema,
])
export type OpaqueBrokerTransport = z.infer<typeof opaqueBrokerTransportSchema>
