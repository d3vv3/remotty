/** @vitest-environment jsdom */

import { act } from "react"
import { createRoot } from "react-dom/client"
import { webcrypto } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { retainedSessionState } from "../src/features/session/model/sessionState"
import { SessionDetail } from "../src/features/session/components/SessionDetail"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

type Message = { info: { id: string; role: string; time: { created: number } }; parts: Array<{ type: string; text: string }> }

const initialMessages: Message[] = [{ info: { id: "one", role: "assistant", time: { created: 1 } }, parts: [{ type: "text", text: "Initial activity" }] }]
const updatedMessages: Message[] = [{ info: { id: "two", role: "assistant", time: { created: 2 } }, parts: [{ type: "text", text: "Prepended activity" }] }, ...initialMessages]
const sessionKey = "scroll-workspace:scroll-session"

const session = (title = "Scroll session") => ({ id: "scroll-session", title, directory: "/workspace", status: "idle" as const, updatedAt: 1, additions: 0, deletions: 0, files: 0, workspaceRelayId: "relay", workspaceId: "scroll-workspace" })

describe("SessionDetail Activity scrolling", () => {
  let container: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  let request: ReturnType<typeof vi.fn>
  let frames: Map<number, FrameRequestCallback>
  let nextFrame: number
  let resizeHeader: () => void
  let resizeSelector: () => void
  let resizeDock: () => void
  let dockHeight: number
  let resizeContent: () => void
  let headerHeight: number
  let disconnectHeader: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    retainedSessionState.clear()
    const cache = {
      version: 2 as const,
      canonical: { manifest: [{ id: "one", fingerprint: "initial" }], records: { one: { message: initialMessages[0], fingerprint: "initial" } }, syncedAt: 0 },
      staged: { records: {} },
      local: { messages: [] },
    }
    retainedSessionState.write(sessionKey, { messageCache: cache, messages: initialMessages, refreshed: { messages: 0 } })
    vi.stubGlobal("crypto", webcrypto)
    frames = new Map()
    nextFrame = 1
    headerHeight = 120
    dockHeight = 194
    disconnectHeader = vi.fn()
    vi.stubGlobal("ResizeObserver", class {
      private header = false
      constructor(private callback: () => void) {}
      observe(element: HTMLElement) {
        if (element.classList.contains("detail-header")) { resizeHeader = this.callback; this.header = true }
        if (element.classList.contains("session-dock")) resizeDock = this.callback
        if (element.classList.contains("detail-content")) resizeContent = this.callback
        if (element.classList.contains("subagent-selector")) resizeSelector = this.callback
        vi.spyOn(element, "getBoundingClientRect").mockImplementation(() => ({ height: element.classList.contains("session-dock") ? dockHeight : headerHeight }) as DOMRect)
      }
      disconnect = () => { if (this.header) disconnectHeader() }
    })
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const frame = nextFrame++
      frames.set(frame, callback)
      return frame
    })
    vi.stubGlobal("cancelAnimationFrame", (frame: number) => frames.delete(frame))
    request = vi.fn(async (command: { type: string }, progress?: (messages: Message[], isActive: () => boolean) => Promise<void>) => {
      if (command.type !== "session.messages") return []
      await progress?.(updatedMessages, () => true)
      return updatedMessages
    })
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    await render()
  })

  afterEach(async () => {
    if (root) await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  const render = async ({ resourceRevision = 0, title = "Scroll session", status = "idle" }: { resourceRevision?: number; title?: string; status?: "idle" | "busy" } = {}) => {
    await act(async () => {
      root.render(<SessionDetail
        session={{ ...session(title), status }} sessionKey={sessionKey} agents={[]} revision={0}
        resourceRevisions={{ messages: resourceRevision, todos: 0, diffs: 0 }}
        subagents={[]} subagentRevisions={{}} supportsSubagents permission={undefined} question={undefined}
        request={request} loadCache={vi.fn()} saveCache={vi.fn().mockResolvedValue(undefined)}
        onBack={vi.fn()} onError={vi.fn()} onPromptFocused={vi.fn()}
      />)
    })
  }

  const activity = () => container.querySelector<HTMLDivElement>(".detail-content")!
  const flushFrames = async () => {
    while (frames.size) {
      const pending = [...frames.values()]
      frames.clear()
      await act(async () => {
        pending.forEach((callback) => callback(0))
      })
    }
  }
  const setGeometry = (scrollTop: number, scrollHeight = 1_000) => {
    const element = activity()
    let top = scrollTop
    let height = scrollHeight
    let viewportHeight = 200
    let writes = 0
    const maxScrollTop = () => Math.max(0, height - viewportHeight)
    Object.defineProperties(element, {
      clientHeight: { configurable: true, get: () => viewportHeight },
      scrollHeight: { configurable: true, get: () => height },
      scrollTop: {
        configurable: true,
        get: () => top,
        set: (value: number) => {
          writes += 1
          top = Math.min(Math.max(0, value), maxScrollTop())
        },
      },
    })
    top = Math.min(top, maxScrollTop())
    return {
      element,
      get writes() { return writes },
      resetWrites: () => { writes = 0 },
      setViewportHeight: (next: number) => { viewportHeight = next },
      setScrollHeight: (next: number, preserveAnchor = false) => {
        const previous = height
        height = next
        top = Math.min(Math.max(0, top + (preserveAnchor ? next - previous : 0)), maxScrollTop())
      },
    }
  }
  const scroll = (element: HTMLDivElement) => act(async () => { element.dispatchEvent(new Event("scroll", { bubbles: true })) })
  const waitForRefresh = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  const select = async (name: string) => {
    const button = [...container.querySelectorAll<HTMLButtonElement>("[role=tab]")].find((item) => item.textContent?.startsWith(name))!
    await act(async () => button.click())
  }

  it("pins initial Activity layout to the clamped bottom", async () => {
    const geometry = setGeometry(0, 1_000)
    await flushFrames()

    expect(geometry.element.scrollTop).toBe(800)
  })

  it("updates the bottom inset for requests and keyboard resizing while preserving follow intent", async () => {
    const geometry = setGeometry(0)
    await act(async () => resizeDock())
    await flushFrames()
    expect(container.querySelector<HTMLElement>('.session-detail')!.style.getPropertyValue('--session-dock-height')).toBe('194px')
    dockHeight = 350
    geometry.setScrollHeight(1156)
    await act(async () => resizeDock())
    await flushFrames()
    expect(geometry.element.scrollTop).toBe(956)
    geometry.element.scrollTop = 240
    await scroll(geometry.element)
    geometry.resetWrites()
    dockHeight = 170
    geometry.setScrollHeight(976)
    await act(async () => resizeDock())
    await flushFrames()
    expect(container.querySelector<HTMLElement>('.session-detail')!.style.getPropertyValue('--session-dock-height')).toBe('170px')
    expect(geometry.writes).toBe(0)
    expect(geometry.element.scrollTop).toBe(240)
  })

  it("keeps following through viewport resize scroll events before the next layout frame", async () => {
    const geometry = setGeometry(0)
    await flushFrames()
    geometry.setViewportHeight(100)
    geometry.setScrollHeight(1300)
    await scroll(geometry.element)
    await act(async () => resizeContent())
    await flushFrames()
    expect(geometry.element.scrollTop).toBe(1200)
    expect(geometry.writes).toBeGreaterThan(1)
  })

  it("shares selector resize measurements with the backdrop only while Subagents is open", async () => {
    const pane = () => container.querySelector<HTMLElement>(".session-detail")!
    expect(pane().style.getPropertyValue("--subagent-selector-height")).toBe("0px")
    await select("Subagents")
    // The selector measurement must reach the shared ancestor without moving
    // the child scrollport.
    headerHeight = 96
    await act(async () => resizeSelector())
    expect(pane().style.getPropertyValue("--subagent-selector-height")).toBe("96px")
    headerHeight = 132
    await act(async () => resizeSelector())
    expect(pane().style.getPropertyValue("--subagent-selector-height")).toBe("132px")
    expect(container.querySelector(".subagent-message-scroll")).not.toBeNull()
    await select("Activity")
    expect(pane().style.getPropertyValue("--subagent-selector-height")).toBe("0px")
  })

  it("removes subagent header and back controls and resets measured heights on tab round trips", async () => {
    await render({ status: "busy" })
    const geometry = setGeometry(240)
    await scroll(geometry.element)
    await flushFrames()
    const pane = () => container.querySelector<HTMLElement>(".session-detail")!
    const status = container.querySelector('.detail-header [role="status"]')!
    expect(status.textContent).toBe("Working")
    expect(status.classList.contains("sr-only")).toBe(true)
    expect(status.querySelector(".status-dot")).toBeNull()
    expect(container.querySelector(".session-folder > span")?.textContent).toBe("workspace")
    headerHeight = 280
    await act(async () => resizeHeader())
    const staleHeaderResize = resizeHeader
    await select("Subagents")
    expect(container.querySelector(".detail-header")).toBeNull()
    expect(container.querySelector('[aria-label="Back"]')).toBeNull()
    expect(container.textContent).not.toContain("Back to Activity")
    expect(pane().style.getPropertyValue("--session-header-height")).toBe("0px")
    await act(async () => staleHeaderResize())
    expect(pane().style.getPropertyValue("--session-header-height")).toBe("0px")
    const commands = container.querySelector(".command-bar")!
    expect(commands.firstElementChild?.getAttribute("aria-label")).toBe("Show tool calls")
    const toggle = commands.firstElementChild as HTMLButtonElement
    const pressed = toggle.getAttribute("aria-pressed")
    await act(async () => toggle.click())
    expect(toggle.getAttribute("aria-pressed")).not.toBe(pressed)
    await act(async () => (commands.lastElementChild as HTMLButtonElement).click())
    expect(request).toHaveBeenCalledWith({ type: "session.abort", sessionId: "scroll-session" })
    headerHeight = 108
    await act(async () => resizeSelector())
    expect(pane().style.getPropertyValue("--subagent-selector-height")).toBe("108px")
    await select("Activity")
    headerHeight = 120
    await act(async () => resizeHeader())
    await flushFrames()
    expect(pane().style.getPropertyValue("--session-header-height")).toBe("120px")
    expect(pane().style.getPropertyValue("--subagent-selector-height")).toBe("0px")
    expect(geometry.element.scrollTop).toBe(240)
    expect(container.querySelector('[aria-label="OpenCode is thinking"]')).not.toBeNull()
    await select("Subagents")
    headerHeight = 112
    await act(async () => resizeSelector())
    expect(pane().style.getPropertyValue("--session-header-height")).toBe("0px")
    expect(pane().style.getPropertyValue("--subagent-selector-height")).toBe("112px")
  })

  it("measures wrapped header spacing and keeps following output on resize", async () => {
    const geometry = setGeometry(0)
    await act(async () => resizeHeader())
    await flushFrames()
    expect((container.firstElementChild as HTMLElement).style.getPropertyValue("--session-header-height")).toBe("120px")
    headerHeight = 280
    geometry.setScrollHeight(1160)
    await act(async () => resizeHeader())
    await flushFrames()
    expect((container.firstElementChild as HTMLElement).style.getPropertyValue("--session-header-height")).toBe("280px")
    expect(geometry.element.scrollTop).toBe(960)
  })

  it("preserves reading intent and tab restoration when overlay height changes", async () => {
    const geometry = setGeometry(240)
    await scroll(geometry.element)
    await flushFrames()
    geometry.resetWrites()
    headerHeight = 280
    await act(async () => resizeHeader())
    await flushFrames()
    expect(geometry.writes).toBe(0)
    await select("Todos")
    geometry.element.scrollTop = 0
    headerHeight = 120
    await act(async () => resizeHeader())
    await select("Activity")
    await flushFrames()
    expect(geometry.element.scrollTop).toBe(240)
    await act(async () => root.unmount())
    expect(disconnectHeader).toHaveBeenCalledOnce()
  })

  it("does not take scroll ownership when hiding or showing tool calls reduces content", async () => {
    const geometry = setGeometry(240)
    await scroll(geometry.element)
    await flushFrames()
    geometry.resetWrites()
    const toggle = container.querySelector<HTMLButtonElement>('[aria-label="Show tool calls"]')!
    await act(async () => toggle.click())
    geometry.setScrollHeight(700)
    await flushFrames()
    expect(geometry.writes).toBe(0)
    expect(activity().scrollTop).toBe(240)
    await act(async () => toggle.click())
    geometry.setScrollHeight(1000)
    await flushFrames()
    expect(geometry.writes).toBe(0)
    expect(activity().scrollTop).toBe(240)
  })

  it("keeps a scrolled-up viewport in place during message progress", async () => {
    const geometry = setGeometry(240)
    await scroll(geometry.element)
    await render({ resourceRevision: 1 })
    await waitForRefresh()
    await flushFrames()

    expect(activity().scrollTop).toBe(240)
  })

  it("follows a larger message scroll height when already pinned", async () => {
    const geometry = setGeometry(800)
    await scroll(geometry.element)
    geometry.setScrollHeight(1_200)
    await render({ resourceRevision: 1 })
    await waitForRefresh()
    await flushFrames()

    expect(activity().scrollTop).toBe(1_000)
  })

  it("restores the prior Activity reading position after a tab round-trip", async () => {
    const geometry = setGeometry(240)
    await scroll(geometry.element)
    await select("Todos")
    await select("Activity")
    await flushFrames()

    expect(activity().scrollTop).toBe(240)
  })

  it("restores an unpinned Activity reading position after off-screen message progress", async () => {
    const geometry = setGeometry(240)
    await scroll(geometry.element)
    await select("Todos")

    geometry.setScrollHeight(1_200, true)
    await render({ resourceRevision: 1 })
    await waitForRefresh()
    await flushFrames()

    await select("Activity")
    await flushFrames()

    expect(activity().scrollTop).toBe(240)
    expect(activity().scrollTop).not.toBe(1_000)
  })

  it("returns to the latest bottom after a tab round-trip when previously pinned", async () => {
    const geometry = setGeometry(800)
    await scroll(geometry.element)
    await select("Todos")
    geometry.setScrollHeight(1_200)
    await select("Activity")
    await flushFrames()

    expect(activity().scrollTop).toBe(1_000)
  })

  it("does not assign scrollTop for unpinned status or prepended resource revision rerenders", async () => {
    const geometry = setGeometry(240)
    await scroll(geometry.element)
    await flushFrames()
    geometry.resetWrites()
    await render({ title: "Busy session", status: "busy" })
    expect(container.querySelector('[aria-label="OpenCode is thinking"]')).not.toBeNull()
    await flushFrames()
    expect(geometry.writes).toBe(0)

    geometry.setScrollHeight(1_200, true)
    await render({ resourceRevision: 1, status: "busy" })
    await waitForRefresh()
    await flushFrames()

    expect(activity().scrollTop).toBe(440)
    expect(geometry.writes).toBe(0)
  })

  it("follows pending responses only while pinned, including tab round trips", async () => {
    const geometry = setGeometry(800)
    await scroll(geometry.element)
    geometry.setScrollHeight(1_100)
    await render({ status: "busy" })
    await flushFrames()
    expect(activity().scrollTop).toBe(900)

    activity().scrollTop = 240
    await scroll(geometry.element)
    await select("Todos")
    await render({ status: "idle" })
    await render({ status: "busy" })
    await select("Activity")
    await flushFrames()
    expect(container.querySelector('[aria-label="OpenCode is thinking"]')).not.toBeNull()
    expect(activity().scrollTop).toBe(240)
  })
})
