import { describe, expect, it, vi } from "vitest"
import { copyPairingToken, terminalHyperlink } from "../src/cli-core"

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
