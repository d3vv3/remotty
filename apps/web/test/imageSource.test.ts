import { afterEach, describe, expect, it, vi } from "vitest"
import { classifyImageSource, fetchImage } from "../src/features/attachments/imageSource"
import { decodeImageBase64, MAX_IMAGE_BYTES } from "@remotty/protocol"

const origin = "https://remotty.example"
const png = decodeImageBase64("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=")
const external = { kind: "external" as const, url: "https://images.example/image.png", host: "images.example" }
afterEach(() => vi.unstubAllGlobals())
describe("browser image sources", () => {
  it.each(["file:///tmp/image.png", "/tmp/image.png", "/api/image.png", "blob:https://remotty.example/123", "http://example.com/image.png", "https://user:password@example.com/image.png", "https://127.0.0.1/image", "https://2130706433/image", "https://0x7f000001/image", "https://10.0.0.1/image", "https://172.16.0.1/image", "https://192.168.1.1/image", "https://169.254.169.254/image", "https://[::1]/image", "https://[::ffff:127.0.0.1]/image", "https://localhost/image", "https://printer.local/image", "https://example.com./image", "/assets/file.svg", "/assets/file.png?url=/api/secrets"]) ("blocks %s", (source) => expect(classifyImageSource(source, origin).kind).toBe("blocked"))
  it("permits only safe static assets automatically", () => {
    expect(classifyImageSource("/assets/image-abc.png", origin).kind).toBe("static")
    expect(classifyImageSource(external.url, origin).kind).toBe("external")
    expect(classifyImageSource("https://[2606:4700:4700::1111]/image.png", origin).kind).toBe("external")
  })
  it("uses CORS, no credentials, no referrer, and no redirects", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(png, { headers: { "content-type": "image/png" } }))
    vi.stubGlobal("fetch", fetch)
    expect((await fetchImage(external, new AbortController().signal)).bytes).toEqual(png)
    expect(fetch).toHaveBeenCalledWith(external.url, expect.objectContaining({ mode: "cors", credentials: "omit", referrerPolicy: "no-referrer", redirect: "error" }))
  })
  it("rejects lying lengths and bounded streams without trusting headers", async () => {
    for (const headers of [{ "content-length": String(MAX_IMAGE_BYTES + 1) }, { "content-length": "1" }, {}]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array(MAX_IMAGE_BYTES + 1), { headers: { ...headers, "content-type": "image/png" } })))
      await expect(fetchImage(external, new AbortController().signal)).rejects.toThrow("5 MiB")
    }
  })
  it("does not use a direct-image fallback after CORS or MIME failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")))
    await expect(fetchImage(external, new AbortController().signal)).rejects.toThrow()
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(png, { headers: { "content-type": "image/jpeg" } })))
    await expect(fetchImage(external, new AbortController().signal)).rejects.toThrow("MIME")
  })
})
