/** @vitest-environment jsdom */

import { act, useState } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SubagentActivity } from "../src/features/session/components/SubagentActivity"
import { retainedSessionState } from "../src/features/session/model/sessionState"
import type { SessionSubagent } from "../src/features/session/model/sessionTypes"
import type { MessagePart, SessionMessage } from "../src/features/session/model/sessionContent"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const child = (id: string, updatedAt: number, status: SessionSubagent["status"] = "busy"): SessionSubagent => ({
  id, updatedAt, status, title: `Task ${id}`, agent: "explore", workspaceId: "workspace", parentSessionId: "parent", rootSessionId: "parent", directory: "/fixture", additions: 0, deletions: 0, files: 0,
})

describe("SubagentActivity selection", () => {
  let container: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  const request = vi.fn(async () => [])
  beforeEach(() => {
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    vi.stubGlobal("requestAnimationFrame", () => 1)
    vi.stubGlobal("cancelAnimationFrame", vi.fn())
    request.mockClear()
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    retainedSessionState.clear()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("renders only three newest buttons and switches cached activity when selected or evicted", async () => {
    function Fixture({ children }: { children: SessionSubagent[] }) {
      const [selected, select] = useState("a")
      return <SubagentActivity subagents={children} selectedChildId={selected} onSelect={select} request={request} revisions={{}} />
    }
    const children = [child("a", 1), child("c", 3, "retry"), child("b", 2), child("d", 4, "error")]
    await act(async () => root.render(<Fixture children={children} />))
    const buttons = [...container.querySelectorAll<HTMLButtonElement>(".subagent-list button")]
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Task d . explore . Error", "Task c . explore . Retrying", "Task b . explore . Working",
    ])
    expect(buttons.map((button) => button.getAttribute("aria-pressed"))).toEqual(["true", "false", "false"])
    expect(request).toHaveBeenLastCalledWith({ type: "session.messages", sessionId: "d" })
    buttons[1]!.focus()
    expect(document.activeElement).toBe(buttons[1])
    expect(buttons[1]!.type).toBe("button")
    await act(async () => buttons[1]!.click())
    expect(buttons[1]!.getAttribute("aria-pressed")).toBe("true")
    expect(request).toHaveBeenLastCalledWith({ type: "session.messages", sessionId: "c" })
    await act(async () => buttons[0]!.click())
    expect(request).toHaveBeenCalledTimes(2)
    await act(async () => root.render(<Fixture children={[child("e", 5), child("f", 6), child("g", 7), ...children]} />))
    expect(container.querySelector('[aria-pressed="true"]')?.getAttribute("aria-label")).toBe("Task g . explore . Working")
    expect(container.querySelectorAll(".subagent-list button")).toHaveLength(3)
    expect(request).toHaveBeenLastCalledWith({ type: "session.messages", sessionId: "g" })
  })

  it.each([false, true])("scrolls only the clipped selected pill, reduced motion = %s", async (reduced) => {
    const scrollBy = vi.fn()
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: reduced })))
    Object.defineProperty(container, "scrollBy", { value: scrollBy })
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("subagent-list")) {
        this.scrollBy = scrollBy
        return { left: 0, right: 300 } as DOMRect
      }
      return { left: 320, right: 560 } as DOMRect
    })
    await act(async () => root.render(<SubagentActivity subagents={[child("a", 1)]} onSelect={vi.fn()} request={request} revisions={{}} />))
    expect(scrollBy).toHaveBeenCalledExactlyOnceWith({ left: 272, behavior: reduced ? "instant" : "smooth" })
  })

  it.each<{ name: string; parts: MessagePart[]; bylines: number }>([
    { name: "empty assistant", parts: [], bylines: 1 },
    { name: "reasoning-only assistant", parts: [{ type: "reasoning", time: { start: 1 } }], bylines: 1 },
    { name: "whitespace assistant", parts: [{ type: "text", text: "  " }], bylines: 1 },
    { name: "tool-only assistant", parts: [{ type: "tool", tool: "read", state: { status: "completed", output: "Retained tool output" } }], bylines: 2 },
    { name: "text assistant", parts: [{ type: "text", text: "**Progress** so far" }], bylines: 2 },
  ])("shows one pending indicator for an active $name and stops on idle/error", async ({ parts, bylines }) => {
    const messages: SessionMessage[] = [{ info: { id: "assistant", role: "assistant" }, parts }]
    retainedSessionState.write("workspace:a", { messages, refreshed: { messages: 0 } })
    const render = async (status: SessionSubagent["status"]) => {
      await act(async () => root.render(<SubagentActivity subagents={[child("a", 2, status), child("b", 1, "busy")]} selectedChildId="a" onSelect={vi.fn()} request={request} revisions={{}} />))
    }
    for (const status of ["busy", "retry"] as const) {
      await render(status)
      const author = bylines === 1 ? "OpenCode" : "explore"
      expect(container.querySelectorAll(`[role="status"][aria-label="${author} (subagent) is thinking"]`)).toHaveLength(1)
      expect(container.querySelector(".pending-response .lucide-network")).not.toBeNull()
      expect(container.querySelector(".pending-response .lucide-brain")).not.toBeNull()
      expect(container.querySelectorAll(".entry-byline")).toHaveLength(bylines)
      expect(container.querySelector(".message:last-child .pending-response")).not.toBeNull()
      expect(container.querySelector(".work-strip")).toBeNull()
      expect(container.querySelector("time")).toBeNull()
      if (parts[0]?.type === "tool") expect(container.querySelector(".tool-details")?.textContent).toContain("Retained tool output")
      if (parts[0]?.text?.includes("Progress")) expect(container.querySelector(".markdown strong")?.textContent).toBe("Progress")
    }
    for (const status of ["idle", "error"] as const) {
      await render(status)
      expect(container.querySelector(".pending-response")).toBeNull()
      expect(container.querySelectorAll(".entry-byline")).toHaveLength(1)
    }
    expect(request).not.toHaveBeenCalled()
    expect(retainedSessionState.read("workspace:a")?.messages).toEqual(messages)
  })

  it("uses the existing trailing assistant byline after tool output", async () => {
    retainedSessionState.write("workspace:a", { messages: [
      { info: { id: "tool", role: "assistant" }, parts: [{ type: "tool", tool: "read", state: { output: "Tool output" } }] },
      { info: { id: "pending", role: "assistant" }, parts: [] },
    ], refreshed: { messages: 0 } })
    await act(async () => root.render(<SubagentActivity subagents={[child("a", 1)]} onSelect={vi.fn()} request={request} revisions={{}} />))
    expect(container.querySelectorAll(".entry-byline")).toHaveLength(2)
    expect(container.querySelectorAll(".pending-response")).toHaveLength(1)
    expect(container.querySelector(".message:last-child .pending-response")).not.toBeNull()
    expect(container.querySelector(".tool-details")?.textContent).toContain("Tool output")
  })

  it("keeps initial fetching separate and shows pending only after a successful empty result", async () => {
    let resolve!: (value: unknown) => void
    const fetch = vi.fn(() => new Promise<unknown>((done) => { resolve = done }))
    await act(async () => root.render(<SubagentActivity subagents={[child("a", 1)]} onSelect={vi.fn()} request={fetch} revisions={{}} />))
    expect(container.querySelector(".spin")).not.toBeNull()
    expect(container.querySelector(".pending-response")).toBeNull()
    await act(async () => resolve([]))
    expect(container.querySelector(".spin")).toBeNull()
    expect(container.querySelectorAll(".pending-response")).toHaveLength(1)
    expect(container.textContent).not.toContain("No message activity yet")
    expect(retainedSessionState.read("workspace:a")?.messages).toEqual([])
  })

  it("stops pending on refresh failure while preserving cached content", async () => {
    retainedSessionState.write("workspace:a", { messages: [{ info: { id: "assistant", role: "assistant" }, parts: [{ type: "text", text: "Cached activity" }] }], refreshed: { messages: 0 } })
    const fetch = vi.fn(async () => { throw new Error("Offline") })
    await act(async () => root.render(<SubagentActivity subagents={[child("a", 1)]} onSelect={vi.fn()} request={fetch} revisions={{ a: 1 }} />))
    expect(container.querySelector(".pending-response")).toBeNull()
    expect(container.textContent).toContain("Activity refresh failed: Offline")
    expect(container.querySelector('.ui-notice[role="status"]')?.textContent).toBe("Activity refresh failed: Offline")
    expect(container.querySelector('.ui-notice svg')?.getAttribute("aria-hidden")).toBe("true")
    expect(container.textContent).toContain("Cached activity")
  })
})
