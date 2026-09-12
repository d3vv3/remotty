/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ImagePreview } from "../src/features/attachments/ImagePreview"
import { AttachmentProvider } from "../src/features/attachments/AttachmentProvider"
import { ActivityMessages } from "../src/features/session/components/ActivityMessages"
import { activityPresentation } from "../src/features/session/model/activityPresentation"
import { decodeImageBase64 } from "@remotty/protocol"

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII="
const url = `data:image/png;base64,${png}`
describe("image preview lifecycle and consent", () => {
  let container: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  let intersect: () => void
  const fetch = vi.fn()
  const createUrl = vi.fn(() => "blob:owned")
  const revokeUrl = vi.fn()
  beforeEach(() => {
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    vi.stubGlobal("fetch", fetch)
    vi.stubGlobal("IntersectionObserver", class {
      constructor(callback: IntersectionObserverCallback) { intersect = () => callback([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver) }
      observe() {}
      disconnect() {}
    })
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: 1, height: 1, close: vi.fn() }))
    URL.createObjectURL = createUrl
    URL.revokeObjectURL = revokeUrl
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { callback(0); return 1 })
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })
  it("never fetches an external image until its own Load confirmation; CORS failures remain placeholders", async () => {
    fetch.mockRejectedValue(new TypeError("CORS unavailable"))
    await act(async () => root.render(<ImagePreview source="https://images.example/a.png" alt="External result" />))
    await act(async () => intersect())
    expect(fetch).not.toHaveBeenCalled()
    expect(container.textContent).toContain("Loading contacts images.example")
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click())
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(container.querySelector("img")).toBeNull()
    expect(container.querySelector("a")?.href).toBe("https://images.example/a.png")
    await act(async () => root.render(<ImagePreview source="https://images.example/b.png" />))
    await act(async () => intersect())
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain("Load image")
  })
  it("validates an inline image before display, supports keyboard expansion and revokes on cleanup", async () => {
    await act(async () => root.render(<ImagePreview source={url} alt="Generated image" />))
    expect(createUrl).not.toHaveBeenCalled()
    await act(async () => intersect())
    expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:owned")
    const button = container.querySelector<HTMLButtonElement>("button")!
    await act(async () => button.click())
    expect(document.querySelector('[role="dialog"]')).toBeTruthy()
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(button)
    await act(async () => root.render(<></>))
    expect(revokeUrl).toHaveBeenCalledWith("blob:owned")
    expect(fetch).not.toHaveBeenCalled()
  })
  it("requests an attachment only in the viewport and keeps workspace and message IDs", async () => {
    const read = vi.fn().mockResolvedValue(decodeImageBase64(png))
    const address = { sessionId: "s", messageId: "m", attachmentId: "f" }
    const descriptor = { storage: "remotty-attachment-v1" as const, id: "f", mime: "image/png" as const, byteLength: 68, digest: "0".repeat(64) }
    await act(async () => root.render(<AttachmentProvider workspaceRelayId="workspace" read={read}><ImagePreview source="remotty-attachment:f" address={address} descriptor={descriptor} /></AttachmentProvider>))
    expect(read).not.toHaveBeenCalled()
    await act(async () => intersect())
    expect(read).toHaveBeenCalledWith("workspace", address, descriptor, expect.any(AbortSignal))
  })
  it("keeps standalone image messages when tools are hidden and hides completed tool images", async () => {
    const file = { type: "file", url, filename: "standalone.png" }
    const message = { info: { id: "m", role: "assistant", agent: "Review" }, parts: [file, { type: "tool", state: { status: "completed", attachments: [{ ...file, filename: "tool.png" }] } }] }
    const presentation = activityPresentation([message], "idle", false, false)
    expect(presentation.messages).toHaveLength(1)
    await act(async () => root.render(<ActivityMessages presentation={presentation} showToolCalls={false} />))
    expect(container.textContent).toContain("standalone.png")
    expect(container.textContent).not.toContain("tool.png")
    await act(async () => root.render(<ActivityMessages presentation={presentation} showToolCalls />))
    expect(container.textContent).toContain("tool.png")
  })
  it("offers an explicit retry for an attachment transfer failure", async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error("Transfer timed out")).mockResolvedValue(decodeImageBase64(png))
    const address = { sessionId: "s", messageId: "m", attachmentId: "f" }
    const descriptor = { storage: "remotty-attachment-v1" as const, id: "f", mime: "image/png" as const, byteLength: 68, digest: "0".repeat(64) }
    await act(async () => root.render(<AttachmentProvider workspaceRelayId="workspace" read={read}><ImagePreview source="remotty-attachment:f" address={address} descriptor={descriptor} /></AttachmentProvider>))
    await act(async () => intersect())
    expect(container.textContent).toContain("Transfer timed out")
    expect(read).toHaveBeenCalledTimes(1)
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click())
    expect(read).toHaveBeenCalledTimes(2)
    expect(container.querySelector("img")).toBeTruthy()
  })
  it("does not let a surrounding Markdown link navigate from image controls", async () => {
    const message = { info: { id: "m", role: "assistant" }, parts: [{ type: "text", text: `[![result](${url})](https://external.example/)` }] }
    await act(async () => root.render(<ActivityMessages presentation={activityPresentation([message], "idle", false, false)} />))
    expect(container.querySelector("a")).toBeNull()
    expect(container.querySelector(".image-preview")).toBeTruthy()
  })
})
