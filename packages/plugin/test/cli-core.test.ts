import { describe, expect, it, vi } from "vitest"
import { copyPairingToken, terminalHyperlink, terminalQrCode } from "../src/cli-core"

describe("terminalHyperlink", () => {
  it("keeps redirected output plain", () => {
    expect(terminalHyperlink("https://example.test/pair#token", false)).toBe("https://example.test/pair#token")
  })

  it("adds an OSC 8 link in an interactive terminal", () => {
    const url = "https://example.test/pair#token"
    expect(terminalHyperlink(url, true)).toBe(`\u001B]8;;${url}\u0007${url}\u001B]8;;\u0007`)
  })
})

describe("copyPairingToken", () => {
  it("copies the raw invite token", async () => {
    const write = vi.fn(async () => undefined)
    await expect(copyPairingToken("remotty:v2:invite", write)).resolves.toBe(true)
    expect(write).toHaveBeenCalledWith("remotty:v2:invite")
  })

  it("reports an unavailable clipboard without throwing", async () => {
    const write = vi.fn(async () => { throw new Error("unavailable") })
    await expect(copyPairingToken("remotty:v2:invite", write)).resolves.toBe(false)
  })
})

describe("terminalQrCode", () => {
  it("renders a compact high-density QR code", () => {
    const output = terminalQrCode("https://example.test/pair#invite")
    const lines = output.split("\n")
    const visibleLines = lines.map((line) => line.replace(/\u001B\[[0-9;]*m/g, ""))

    expect(lines.length).toBeGreaterThan(10)
    expect(new Set(visibleLines.map((line) => Array.from(line).length))).toEqual(new Set([visibleLines[0]!.length]))
    expect(visibleLines.some((line) => /[^ ]/.test(line))).toBe(true)
    expect(Math.max(...visibleLines.map((line) => Array.from(line).length))).toBeLessThan(30)

    const longInvite = terminalQrCode(`https://example.test/pair#${"x".repeat(500)}`)
      .replace(/\u001B\[[0-9;]*m/g, "")
      .split("\n")
    expect(longInvite.length).toBeLessThan(70)
    expect(Math.max(...longInvite.map((line) => Array.from(line).length))).toBeLessThan(70)
  })
})
