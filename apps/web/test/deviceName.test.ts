import { describe, expect, it } from "vitest"
import { deviceName } from "../src/infrastructure/storage/deviceName"

const id = "abcdef123456"

describe("deviceName", () => {
  it.each([
    ["Safari on iPadOS (abcdef)", { userAgent: "Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1", platform: "MacIntel", maxTouchPoints: 5 }],
    ["Chrome on Android (abcdef)", { userAgent: "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36", platform: "Linux armv8l", maxTouchPoints: 5 }],
    ["Firefox on Linux (abcdef)", { userAgent: "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0", platform: "Linux x86_64", maxTouchPoints: 0 }],
    ["Edge on Windows (abcdef)", { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0", platform: "Win32", maxTouchPoints: 0 }],
  ])("labels %s", (expected, hints) => {
    expect(deviceName(id, hints)).toBe(expected)
  })
})
