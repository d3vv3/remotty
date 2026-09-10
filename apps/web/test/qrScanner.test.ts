import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

const appSource = () => readFile(new URL("../src/features/pairing/PairingScreen.tsx", import.meta.url), "utf8")

describe("pairing QR scanner", () => {
  it("requests a high resolution camera stream with continuous focus", async () => {
    const app = await appSource()
    expect(app).toContain('facingMode: "environment"')
    expect(app).toContain("width: { ideal: 1920 }")
    expect(app).toContain("height: { ideal: 1080 }")
    expect(app).toContain('focusMode: "continuous"')
  })

  it("prefers the native BarcodeDetector and falls back to zxing with TRY_HARDER", async () => {
    const app = await appSource()
    expect(app).toContain("BarcodeDetector?: BarcodeDetectorLike")
    expect(app).toContain('formats: ["qr_code"]')
    expect(app).toContain("DecodeHintType.TRY_HARDER")
    expect(app).toContain("delayBetweenScanAttempts: 50")
  })

  it("moves focus into the modal and delegates focus restoration and Escape handling", async () => {
    const [app, focusHook] = await Promise.all([
      appSource(),
      readFile(new URL("../src/hooks/useDialogFocus.ts", import.meta.url), "utf8"),
    ])
    expect(app).toContain("useDialogFocus({ onClose })")
    expect(app).toContain("autoFocus aria-label=\"Close scanner\"")
    expect(focusHook).toContain('event.key === "Escape"')
    expect(focusHook).toContain("restoreTargetRef.current)?.focus()")
  })
})
