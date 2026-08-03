import {
  e2eeFrameSchema,
  ecPublicJwkSchema,
  pairingBundleSchema,
  type EcPublicJwk,
  type E2eeChannel,
  type E2eeFrame,
  type E2eeFrameHeader,
  type PairingBundle,
} from "./e2ee-schema"

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

export interface ExportedKeyPair {
  publicKey: EcPublicJwk
  privateKey: JsonWebKey
}

export interface SealJsonPayloadOptions {
  channel: Exclude<E2eeChannel, "enroll">
  sender: string
  recipient: string
  messageId: string
  issuedAt: number
  senderSigningPrivateKey: JsonWebKey
  senderEncryptionPrivateKey: JsonWebKey
  recipientEncryptionPublicKey: EcPublicJwk
}

export interface OpenJsonPayloadOptions {
  recipient: string
  recipientEncryptionPrivateKey: JsonWebKey
  senderEncryptionPublicKey: EcPublicJwk
  senderSigningPublicKey: EcPublicJwk
}

export interface SealEnrollmentPayloadOptions {
  sender: string
  recipient: string
  messageId: string
  issuedAt: number
  signingPrivateKey: JsonWebKey
  senderEncryptionPrivateKey: JsonWebKey
  senderEncryptionPublicKey: EcPublicJwk
  recipientEncryptionPublicKey: EcPublicJwk
}

export interface OpenEnrollmentPayloadOptions<T> {
  recipient: string
  recipientEncryptionPrivateKey: JsonWebKey
  signingPublicKey: EcPublicJwk | ((payload: T) => EcPublicJwk)
}

const encoder = new TextEncoder()
const decoder = new TextDecoder("utf-8", { fatal: true })
export const PAIRING_BUNDLE_PREFIX = "remotty:v2:"
const signingPrivateKeyCache = new Map<string, Promise<CryptoKey>>()
const signingPublicKeyCache = new Map<string, Promise<CryptoKey>>()
const encryptionKeyCache = new Map<string, Promise<CryptoKey>>()

const boundedCache = <T>(cache: Map<string, T>, key: string, create: () => T) => {
  const existing = cache.get(key)
  if (existing) return existing
  if (cache.size >= 64) cache.clear()
  const value = create()
  cache.set(key, value)
  return value
}

function webcrypto(): Crypto {
  if (!globalThis.crypto?.subtle) throw new Error("WebCrypto is unavailable")
  return globalThis.crypto
}

function bytes(value: ArrayBuffer | ArrayBufferView): Uint8Array<ArrayBuffer> {
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer)
}

export function base64urlEncode(value: ArrayBuffer | ArrayBufferView): string {
  const input = bytes(value)
  let binary = ""
  for (let offset = 0; offset < input.length; offset += 0x8000) {
    binary += String.fromCharCode(...input.subarray(offset, offset + 0x8000))
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")
}

export function base64urlDecode(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(value) || value.length % 4 === 1) {
    throw new Error("Invalid base64url")
  }
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=")
  let binary: string
  try {
    binary = atob(padded)
  } catch {
    throw new Error("Invalid base64url")
  }
  const result = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  if (base64urlEncode(result) !== value) throw new Error("Invalid base64url")
  return result
}

export function canonicalizeJson(value: JsonValue): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value)
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON only supports finite numbers")
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalizeJson).join(",")}]`
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalizeJson(value[key] as JsonValue)}`)
    .join(",")}}`
}

function frameHeader(frame: E2eeFrame | E2eeFrameHeader): E2eeFrameHeader {
  return {
    type: frame.type,
    version: frame.version,
    channel: frame.channel,
    sender: frame.sender,
    recipient: frame.recipient,
    messageId: frame.messageId,
    issuedAt: frame.issuedAt,
    nonce: frame.nonce,
    ...(frame.enrollmentKey ? { enrollmentKey: frame.enrollmentKey } : {}),
  }
}

export function canonicalFrameAdditionalData(frame: E2eeFrame | E2eeFrameHeader): Uint8Array<ArrayBuffer> {
  return encoder.encode(canonicalizeJson(frameHeader(frame)))
}

export function canonicalFrameSigningInput(
  frame: E2eeFrameHeader & { ciphertext: string },
): Uint8Array<ArrayBuffer> {
  return encoder.encode(
    canonicalizeJson({
      ...frameHeader(frame),
      ciphertext: frame.ciphertext,
    }),
  )
}

async function exportKeyPair(pair: CryptoKeyPair): Promise<ExportedKeyPair> {
  const [publicKey, privateKey] = await Promise.all([
    webcrypto().subtle.exportKey("jwk", pair.publicKey),
    webcrypto().subtle.exportKey("jwk", pair.privateKey),
  ])
  return { publicKey: ecPublicJwkSchema.parse(publicKey), privateKey }
}

export async function generateSigningKeyPair(): Promise<ExportedKeyPair> {
  const pair = (await webcrypto().subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair
  return exportKeyPair(pair)
}

export async function generateEncryptionKeyPair(): Promise<ExportedKeyPair> {
  const pair = (await webcrypto().subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  )) as CryptoKeyPair
  return exportKeyPair(pair)
}

export async function signingKeyFingerprint(publicKey: EcPublicJwk): Promise<string> {
  const key = ecPublicJwkSchema.parse(publicKey)
  const identity = canonicalizeJson({ crv: key.crv, kty: key.kty, x: key.x, y: key.y })
  return base64urlEncode(await webcrypto().subtle.digest("SHA-256", encoder.encode(identity)))
}

async function importSigningPrivateKey(key: JsonWebKey): Promise<CryptoKey> {
  const cacheKey = `${key.x}:${key.y}:${key.d}`
  return boundedCache(signingPrivateKeyCache, cacheKey, () =>
    webcrypto().subtle.importKey("jwk", key, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]))
}

async function importSigningPublicKey(key: EcPublicJwk): Promise<CryptoKey> {
  const parsed = ecPublicJwkSchema.parse(key)
  return boundedCache(signingPublicKeyCache, `${parsed.x}:${parsed.y}`, () =>
    webcrypto().subtle.importKey("jwk", parsed, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]))
}

async function deriveEncryptionKey(privateKey: JsonWebKey, publicKey: EcPublicJwk): Promise<CryptoKey> {
  const parsedPublicKey = ecPublicJwkSchema.parse(publicKey)
  const cacheKey = `${privateKey.x}:${privateKey.y}:${privateKey.d}:${parsedPublicKey.x}:${parsedPublicKey.y}`
  return boundedCache(encryptionKeyCache, cacheKey, async () => {
  const [privateCryptoKey, publicCryptoKey] = await Promise.all([
    webcrypto().subtle.importKey("jwk", privateKey, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]),
    webcrypto().subtle.importKey(
      "jwk",
      parsedPublicKey,
      { name: "ECDH", namedCurve: "P-256" },
      false,
      [],
    ),
  ])
  const secret = await webcrypto().subtle.deriveBits({ name: "ECDH", public: publicCryptoKey }, privateCryptoKey, 256)
  const material = await webcrypto().subtle.importKey("raw", secret, "HKDF", false, ["deriveKey"])
  return webcrypto().subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(32),
      info: encoder.encode("remotty:e2ee:v2:aes-256-gcm"),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  )
  })
}

async function signFrame(frame: E2eeFrameHeader & { ciphertext: string }, privateKey: JsonWebKey): Promise<string> {
  const key = await importSigningPrivateKey(privateKey)
  const signature = await webcrypto().subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    canonicalFrameSigningInput(frame),
  )
  return base64urlEncode(signature)
}

export async function signCanonicalJson(value: JsonValue, privateKey: JsonWebKey): Promise<string> {
  const key = await importSigningPrivateKey(privateKey)
  return base64urlEncode(await webcrypto().subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    encoder.encode(canonicalizeJson(value)),
  ))
}

export async function verifyCanonicalJson(
  value: JsonValue,
  signature: string,
  publicKey: EcPublicJwk,
): Promise<boolean> {
  const key = await importSigningPublicKey(publicKey)
  return webcrypto().subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    base64urlDecode(signature),
    encoder.encode(canonicalizeJson(value)),
  )
}

export const transportProofPayload = (
  role: "relay" | "client",
  identity: string,
  roomToken: string,
  challenge: string,
): JsonValue => ({ type: "transport.proof", version: 2, role, identity, roomToken, challenge })

export const deviceCertificatePayload = (deviceId: string, roomToken: string): JsonValue =>
  ({ type: "device.certificate", version: 2, deviceId, roomToken })

export async function verifyFrameSignature(frame: E2eeFrame, publicKey: EcPublicJwk): Promise<boolean> {
  const parsed = e2eeFrameSchema.parse(frame)
  const key = await importSigningPublicKey(publicKey)
  return webcrypto().subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    base64urlDecode(parsed.signature),
    canonicalFrameSigningInput(parsed),
  )
}

async function encryptPayload(
  payload: JsonValue,
  header: E2eeFrameHeader,
  key: CryptoKey,
  signingPrivateKey: JsonWebKey,
): Promise<E2eeFrame> {
  const ciphertext = base64urlEncode(
    await webcrypto().subtle.encrypt(
      { name: "AES-GCM", iv: base64urlDecode(header.nonce), additionalData: canonicalFrameAdditionalData(header) },
      key,
      encoder.encode(canonicalizeJson(payload)),
    ),
  )
  return e2eeFrameSchema.parse({ ...header, ciphertext, signature: await signFrame({ ...header, ciphertext }, signingPrivateKey) })
}

async function decryptPayload<T>(frame: E2eeFrame, key: CryptoKey): Promise<T> {
  const plaintext = await webcrypto().subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64urlDecode(frame.nonce),
      additionalData: canonicalFrameAdditionalData(frame),
    },
    key,
    base64urlDecode(frame.ciphertext),
  )
  return JSON.parse(decoder.decode(plaintext)) as T
}

function createHeader(options: {
  channel: E2eeChannel
  sender: string
  recipient: string
  messageId: string
  issuedAt: number
  enrollmentKey?: EcPublicJwk
}): E2eeFrameHeader {
  const nonce = new Uint8Array(12)
  webcrypto().getRandomValues(nonce)
  return {
    type: "e2ee.frame",
    version: 2,
    channel: options.channel,
    sender: options.sender,
    recipient: options.recipient,
    messageId: options.messageId,
    issuedAt: options.issuedAt,
    nonce: base64urlEncode(nonce),
    ...(options.enrollmentKey ? { enrollmentKey: options.enrollmentKey } : {}),
  }
}

export async function sealJsonPayload(payload: JsonValue, options: SealJsonPayloadOptions): Promise<E2eeFrame> {
  const header = createHeader(options)
  const key = await deriveEncryptionKey(options.senderEncryptionPrivateKey, options.recipientEncryptionPublicKey)
  return encryptPayload(payload, header, key, options.senderSigningPrivateKey)
}

export async function openJsonPayload<T = JsonValue>(frame: E2eeFrame, options: OpenJsonPayloadOptions): Promise<T> {
  const parsed = e2eeFrameSchema.parse(frame)
  if (parsed.channel === "enroll") throw new Error("Enrollment frames require openEnrollmentPayload")
  if (parsed.recipient !== options.recipient) throw new Error("Frame recipient does not match")
  if (!(await verifyFrameSignature(parsed, options.senderSigningPublicKey))) throw new Error("Invalid frame signature")
  const key = await deriveEncryptionKey(options.recipientEncryptionPrivateKey, options.senderEncryptionPublicKey)
  return decryptPayload<T>(parsed, key)
}

export async function sealEnrollmentPayload(
  payload: JsonValue,
  options: SealEnrollmentPayloadOptions,
): Promise<E2eeFrame> {
  const header = createHeader({ ...options, channel: "enroll" })
  header.enrollmentKey = options.senderEncryptionPublicKey
  const key = await deriveEncryptionKey(options.senderEncryptionPrivateKey, options.recipientEncryptionPublicKey)
  return encryptPayload(payload, header, key, options.signingPrivateKey)
}

export async function openEnrollmentPayload<T = JsonValue>(
  frame: E2eeFrame,
  options: OpenEnrollmentPayloadOptions<T>,
): Promise<T> {
  const parsed = e2eeFrameSchema.parse(frame)
  if (parsed.channel !== "enroll") throw new Error("Expected an enrollment frame")
  if (parsed.recipient !== options.recipient) throw new Error("Frame recipient does not match")
  if (!parsed.enrollmentKey) throw new Error("Enrollment frame is missing its encryption key")
  const key = await deriveEncryptionKey(options.recipientEncryptionPrivateKey, parsed.enrollmentKey)
  const payload = await decryptPayload<T>(parsed, key)
  const publicKey = typeof options.signingPublicKey === "function" ? options.signingPublicKey(payload) : options.signingPublicKey
  if (!(await verifyFrameSignature(parsed, publicKey))) throw new Error("Invalid frame signature")
  return payload
}

export function encodePairingBundle(bundle: PairingBundle): string {
  const parsed = pairingBundleSchema.parse(bundle)
  return `${PAIRING_BUNDLE_PREFIX}${base64urlEncode(encoder.encode(canonicalizeJson(parsed)))}`
}

export function decodePairingBundle(value: string): PairingBundle {
  const fragment = value.includes("#") ? value.slice(value.lastIndexOf("#") + 1) : value
  const token = decodeURIComponent(fragment)
  if (!token.startsWith(PAIRING_BUNDLE_PREFIX)) {
    throw new Error(`Pairing bundle must start with ${PAIRING_BUNDLE_PREFIX}`)
  }
  return pairingBundleSchema.parse(
    JSON.parse(decoder.decode(base64urlDecode(token.slice(PAIRING_BUNDLE_PREFIX.length)))),
  )
}
