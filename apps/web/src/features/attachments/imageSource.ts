import { decodeImageDataUrl, MAX_IMAGE_BYTES, validateImage, type ImageMime } from "@remotty/protocol"

export type ImageSource = { kind: "inline"; url: string } | { kind: "static" | "external"; url: string; host: string } | { kind: "blocked"; reason: string }
export function classifyImageSource(source: string, origin: string): ImageSource {
  if (source.startsWith("data:")) return { kind: "inline", url: source }
  try {
    const url = new URL(source, origin)
    if (url.username || url.password) throw new Error()
    if (url.origin === origin && /^\/assets\/[A-Za-z0-9_/-]+\.(?:png|jpe?g|webp|gif|avif)$/i.test(url.pathname) && !url.search && !url.hash) return { kind: "static", url: url.href, host: url.host }
    if (!source.startsWith("https://") || url.origin === origin) throw new Error()
    const host = url.hostname.toLowerCase()
    if (host.startsWith("[")) {
      // Only global-unicast IPv6; excludes loopback, mapped IPv4, ULA, multicast and link-local ranges.
      const prefix = Number.parseInt(host.slice(1).split(":")[0]!, 16)
      if (!(prefix >= 0x2000 && prefix <= 0x3fff)) throw new Error()
    } else if (!host.includes(".") || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".")) throw new Error()
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
      const [a, b] = host.split(".").map(Number)
      if (a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 172 && b! >= 16 && b! <= 31 || a === 192 && b === 168 || a === 100 && b! >= 64 && b! <= 127 || a! >= 224 || a === 198 && (b === 18 || b === 19)) throw new Error()
    }
    return { kind: "external", url: url.href, host: url.host }
  } catch { return { kind: "blocked", reason: "This image source is blocked. Attach the image to the OpenCode message instead of linking a local path." } }
}
/** Called for external sources only from the per-image Load action. */
export async function fetchImage(source: Extract<ImageSource, { kind: "static" | "external" }>, signal: AbortSignal): Promise<{ bytes: Uint8Array<ArrayBuffer>; mime: ImageMime }> {
  const response = await fetch(source.url, { mode: "cors", credentials: "omit", referrerPolicy: "no-referrer", redirect: "error", signal }).catch(() => {
    throw new Error(signal.aborted ? "Image loading timed out or was cancelled." : "Image host unavailable or CORS access denied.")
  })
  if (!response.ok || !response.body) throw new Error("The image could not be loaded. The host may not allow CORS access.")
  const length = response.headers.get("content-length")
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_IMAGE_BYTES)) { await response.body.cancel(); throw new Error("Image exceeds 5 MiB") }
  const mime = response.headers.get("content-type")?.split(";")[0]?.trim()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > MAX_IMAGE_BYTES) throw new Error("Image exceeds 5 MiB")
      chunks.push(value)
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock() }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return { bytes, mime: validateImage(bytes, mime) }
}
export const inlineImage = decodeImageDataUrl
