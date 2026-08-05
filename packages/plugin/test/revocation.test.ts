import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

describe("relay revocation cleanup", () => {
  it("removes the revoked device record after the notification is sent", async () => {
    const source = await readFile(join(__dirname, "..", "src", "index.ts"), "utf8")
    const start = source.indexOf("DeviceRevokedError) {")
    const branch = source.slice(start, source.indexOf("throw error", start))

    expect(branch).toContain('sendEncrypted({ type: "device.revoked", deviceId: error.device.id }, error.device)')
    expect(branch).toContain("updateV2ConfigLocked")
    expect(branch).toContain("candidate.id !== error.device.id || !candidate.revokedAt")
    expect(branch.indexOf("sendEncrypted")).toBeLessThan(branch.indexOf("updateV2ConfigLocked"))
  })
})
