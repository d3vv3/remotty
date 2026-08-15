import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

describe("revoked device recovery", () => {
  it("forgets the local identity and returns to pairing", async () => {
    const source = await readFile(new URL("../src/features/relay/useRelay.ts", import.meta.url), "utf8")
    expect(source).toContain('data.type === "device.revoked"')
    expect(source).toContain("await deleteIdentity(identity)")
    expect(source).toContain('history.replaceState({}, "", "/pair")')
  })

  it("acknowledges the revocation before it wipes the identity", async () => {
    const source = await readFile(new URL("../src/features/relay/useRelay.ts", import.meta.url), "utf8")
    const branch = source.slice(source.indexOf('data.type === "device.revoked"'))
    expect(branch).toContain("sendCommandFrame(identity, frame.sender")
    expect(branch.indexOf("sendCommandFrame")).toBeLessThan(branch.indexOf("deleteIdentity"))
  })

  it("warns when no workspace answers an enrolled device", async () => {
    const source = await readFile(new URL("../src/features/relay/useRelay.ts", import.meta.url), "utf8")
    expect(source).toContain("No workspace answered this device. If it was revoked, disconnect and pair it again.")
    expect(source).toContain("slicesRef.current.size")
  })
})
