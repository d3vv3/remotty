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

  it("pushes device.revoked to freshly revoked devices", async () => {
    const source = await readFile(join(__dirname, "..", "src", "index.ts"), "utf8")

    expect(source).toContain("const notifiedRevocations = new Set<string>()")
    expect(source).toContain("if (!device.revokedAt || notifiedRevocations.has(device.id)) continue")
    expect(source).toContain('sendEncrypted({ type: "device.revoked", deviceId: device.id }, device)')
    expect(source).toContain("setInterval(() => { void pushRevocations().catch(() => undefined) }, 5_000)")
    expect(source).toContain("clearInterval(revocationTimer)")
  })
})
