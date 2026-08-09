import { describe, expect, it } from "vitest"
import { openCodeMessageId } from "../src/messageId"

describe("OpenCode message IDs", () => {
  it("allocates a canonical workstation ID before a same-millisecond assistant ID", () => {
    const now = 1_000
    const id = openCodeMessageId(now, Buffer.alloc(14, 61))
    const assistantPacked = (BigInt(now) * 0x1000n + 1n).toString(16).padStart(12, "0")
    expect(id).toMatch(/^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/)
    expect(id).toHaveLength(30)
    expect(Number.parseInt(id.slice(4, 16), 16) & 0xfff).toBe(0)
    expect(id < `msg_${assistantPacked}${"0".repeat(14)}`).toBe(true)
  })
})
