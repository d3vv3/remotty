import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8")
describe("install branding", () => {
  it("uses the standalone amber code favicon on the app and install guide", () => {
    const tokens = read("../public/design-tokens.css")
    const svg = read("../public/icon.svg")
    for (const token of ["brand", "on-brand"]) expect(svg).toContain(tokens.match(new RegExp(`--${token}: (#[a-fA-F0-9]{6});`))![1])
    expect(svg).toContain('rx="28"')
    expect(svg).not.toMatch(/filter|transform|image|script/)
    for (const path of ["../index.html", "../public/install/index.html"]) {
      expect(read(path)).toContain('<link rel="icon" href="/icon.svg" type="image/svg+xml" />')
      expect(read(path)).toContain('rel="apple-touch-icon" href="/icon-192.png"')
    }
  })
  it.each([192, 512])("ships a %i pixel RGBA install icon referenced by the manifest", (size) => {
    const png = readFileSync(new URL(`../public/icon-${size}.png`, import.meta.url))
    expect(png.subarray(1, 4).toString()).toBe("PNG")
    expect(png.readUInt32BE(16)).toBe(size)
    expect(png.readUInt32BE(20)).toBe(size)
    expect(png[25]).toBe(6)
    expect(read("../vite.config.ts")).toContain(`/icon-${size}.png`)
  })
})
