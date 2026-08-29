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
        subagents={[]} subagentRevisions={{}} permission={undefined} question={undefined}
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
    let writes = 0
    const maxScrollTop = () => Math.max(0, height - 200)
    Object.defineProperties(element, {
      clientHeight: { configurable: true, value: 200 },
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
    await flushFrames()
    expect(geometry.writes).toBe(0)

    geometry.setScrollHeight(1_200, true)
    await render({ resourceRevision: 1, status: "busy" })
    await waitForRefresh()
    await flushFrames()

    expect(activity().scrollTop).toBe(440)
    expect(geometry.writes).toBe(0)
  })
})
