import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

describe("revoked device recovery", () => {
  it("forgets the local identity and returns to pairing", async () => {
    const source = await readFile(new URL("../src/useRelay.ts", import.meta.url), "utf8")
    expect(source).toContain('data.type === "device.revoked"')
    expect(source).toContain("await deleteIdentity(identity)")
    expect(source).toContain('history.replaceState({}, "", "/pair")')
  })
})
