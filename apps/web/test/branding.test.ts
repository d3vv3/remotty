import { readFileSync } from "node:fs"
import { inflateSync } from "node:zlib"
import { describe, expect, it } from "vitest"

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8")
const pixels = (png: Buffer) => {
  const chunks: Buffer[] = []
  for (let i = 8; i < png.length;) {
    const length = png.readUInt32BE(i)
    if (png.toString("ascii", i + 4, i + 8) === "IDAT") chunks.push(png.subarray(i + 8, i + 8 + length))
    i += length + 12
  }
  const raw = inflateSync(Buffer.concat(chunks)), stride = png.readUInt32BE(16) * 4
  const decoded = Buffer.alloc(stride * png.readUInt32BE(20))
  for (let y = 0; y < png.readUInt32BE(20); y++) for (let x = 0; x < stride; x++) {
    const i = y * stride + x, a = x >= 4 ? decoded[i - 4] : 0, b = y ? decoded[i - stride] : 0, c = y && x >= 4 ? decoded[i - stride - 4] : 0
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
    const filter = raw[y * (stride + 1)]
    const predictor = [0, a, b, Math.floor((a + b) / 2), pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter]
    decoded[i] = (raw[y * (stride + 1) + 1 + x] + predictor) & 255
  }
  return decoded
}
describe("install branding", () => {
  it("ships the shared yellow icon and a transparent monochrome notification mask", () => {
    const load = (name: string) => readFileSync(new URL(`../public/${name}.png`, import.meta.url))
    expect(pixels(load("notification-icon-v2"))).toEqual(pixels(load("icon-192")))
    const badge = load("notification-badge-v2")
    expect(badge.readUInt32BE(16)).toBe(96)
    expect(badge.readUInt32BE(20)).toBe(96)
    expect(badge[25]).toBe(6)
    const rgba = pixels(badge), alpha = new Set<number>()
    for (let i = 0; i < rgba.length; i += 4) {
      alpha.add(rgba[i + 3])
      if (rgba[i + 3]) expect([...rgba.subarray(i, i + 3)]).toEqual([255, 255, 255])
    }
    expect(alpha.has(0)).toBe(true)
    expect(alpha.has(255)).toBe(true)
    expect(read("../generate-icons.mjs")).toContain('mark("white")')
  })
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
