import { describe, expect, it, vi } from "vitest"
import { copyPairingToken, terminalHyperlink, terminalQrCode } from "../src/cli-core"

describe("terminalHyperlink", () => {
  it("keeps redirected output plain", () => {
    expect(terminalHyperlink("https://example.test/pair#token", false)).toBe("https://example.test/pair#token")
  })

  it("adds an OSC 8 link in an interactive terminal", () => {
    const url = "https://example.test/pair#token"
    expect(terminalHyperlink(url, true)).toBe(`\u001B]8;;${url}\u0007${url}\u001B]8;;\u0007`)
    expect(terminalHyperlink(url, true, "pairing page")).toBe(`\u001B]8;;${url}\u0007pairing page\u001B]8;;\u0007`)
  })
})

describe("copyPairingToken", () => {
  it("copies the raw invite token", async () => {
    const write = vi.fn(async () => undefined)
    const read = vi.fn(async () => "remotty:v2:invite")
    await expect(copyPairingToken("remotty:v2:invite", write, read)).resolves.toBe(true)
    expect(write).toHaveBeenCalledWith("remotty:v2:invite")
  })

  it("reports an unavailable clipboard without throwing", async () => {
    const write = vi.fn(async () => { throw new Error("unavailable") })
    await expect(copyPairingToken("remotty:v2:invite", write, vi.fn())).resolves.toBe(false)
  })

  it("reports success only when the clipboard contains the token", async () => {
    const write = vi.fn(async () => undefined)
    const read = vi.fn(async () => "previous clipboard value")
    await expect(copyPairingToken("remotty:v2:invite", write, read)).resolves.toBe(false)
  })
})

describe("terminalQrCode", () => {
  it("renders a square high-density QR code", async () => {
    const output = await terminalQrCode("https://example.test/pair#invite")
    const lines = output.split("\n")
    const visibleLines = lines.map((line) => line.replace(/\u001B\[[0-9;]*m/g, "")).filter(Boolean)

    expect(lines.length).toBeGreaterThan(10)
    expect(new Set(visibleLines.map((line) => Array.from(line).length))).toEqual(new Set([visibleLines[0]!.length]))
    expect(visibleLines.some((line) => /[^ ]/.test(line))).toBe(true)
    expect(Math.max(...visibleLines.map((line) => Array.from(line).length))).toBeLessThan(50)

    const longInvite = (await terminalQrCode(`https://example.test/pair#${"x".repeat(500)}`))
      .replace(/\u001B\[[0-9;]*m/g, "")
      .split("\n")
    expect(longInvite.length).toBeLessThan(70)
    expect(Math.max(...longInvite.map((line) => Array.from(line).length))).toBeLessThan(130)
  })
})
