import { describe, expect, it } from "vitest"
import { pairingCredentialFrom } from "../src/pairing"

const credential = "A".repeat(43)

describe("pairingCredentialFrom", () => {
  it("accepts a raw credential", () => {
    expect(pairingCredentialFrom(credential)).toBe(credential)
  })

  it("reads a credential from a pairing deep link", () => {
    expect(pairingCredentialFrom(`https://remotty.devve.space/?code=${credential}`)).toBe(credential)
  })

  it("rejects unrelated QR data", () => {
    expect(pairingCredentialFrom("https://example.com/")).toBeUndefined()
  })
})
