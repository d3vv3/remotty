import { randomBytes } from "node:crypto"

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
const MASK_48 = (1n << 48n) - 1n

export const openCodeMessageId = (now = Date.now(), random = randomBytes(14)) => {
  const packed = (BigInt(now) * 0x1000n) & MASK_48
  const timestamp = packed.toString(16).padStart(12, "0")
  const suffix = Array.from(random, (byte) => ALPHABET[byte % ALPHABET.length]).join("")
  return `msg_${timestamp}${suffix}`
}
