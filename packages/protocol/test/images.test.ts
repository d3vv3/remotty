import { describe, expect, it } from "vitest"
import { attachmentDescriptorSchema, clientCommandSchema, decodeImageBase64, decodeImageDataUrl, MAX_IMAGE_BYTES, validateImage, validateImageDimensions } from "../src"
import { rasterFixtures } from "./imageFixtures"

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII="
describe("raster image validation", () => {
  it.each(Object.entries(rasterFixtures))("validates real %s headers and dimensions", (mime, base64) => {
    expect(decodeImageDataUrl(`data:${mime};base64,${base64}`).mime).toBe(mime)
  })
  it("accepts a tiny PNG and rejects an incorrect MIME", () => {
    expect(decodeImageDataUrl(`data:image/png;base64,${png}`).bytes.length).toBe(68)
    expect(() => decodeImageDataUrl(`data:image/png;base64,${png}`, "image/jpeg")).toThrow()
    expect(() => validateImage(decodeImageBase64(png), "image/jpeg")).toThrow()
  })
  it.each(["file:///etc/passwd", "https://example.com/image.png", "data:image/svg+xml;base64,PHN2Zy8+", "data:image/png,raw", "data:image/png;base64,AA=A", "data:image/png;base64,AAAA\n"]) ("rejects unsupported data source %s", (url) => {
    expect(() => decodeImageDataUrl(url)).toThrow()
  })
  it.each(["", "A===", "AB==", "AAA", "AAAA====", "____", "AA A"]) ("rejects malformed base64 %s", (value) => expect(() => decodeImageBase64(value)).toThrow())
  it("enforces decoded bounds, including a padded last quantum", () => {
    expect(decodeImageBase64(Buffer.alloc(MAX_IMAGE_BYTES).toString("base64"))).toHaveLength(MAX_IMAGE_BYTES)
    expect(() => decodeImageBase64(Buffer.alloc(MAX_IMAGE_BYTES + 1).toString("base64"))).toThrow()
    expect(() => decodeImageBase64(Buffer.alloc(MAX_IMAGE_BYTES + 2).toString("base64"))).toThrow()
  })
  it("rejects oversized dimensions before PNG decode", () => {
    const bytes = decodeImageBase64(png)
    new DataView(bytes.buffer).setUint32(16, 40000)
    expect(() => validateImage(bytes, "image/png")).toThrow("megapixel")
    expect(() => validateImageDimensions(10000, 10000)).toThrow()
    expect(() => validateImageDimensions(0, 1)).toThrow()
  })
  it("accepts only ID-based requests, without URLs, paths, or unknown fields", () => {
    const command = { type: "attachment.get", requestId: "r", sessionId: "s", messageId: "m", attachmentId: "f" }
    expect(clientCommandSchema.safeParse(command).success).toBe(true)
    for (const extra of [{ url: "https://internal/image" }, { path: "/etc/passwd" }, { sessionId: "../secret" }, { attachmentId: "" }]) expect(clientCommandSchema.safeParse({ ...command, ...extra }).success).toBe(false)
    expect(attachmentDescriptorSchema.safeParse({ storage: "remotty-attachment-v1", id: "f", mime: "image/svg+xml", byteLength: 1, digest: "0".repeat(64) }).success).toBe(false)
  })
})
