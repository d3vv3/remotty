/** @vitest-environment jsdom */

import { act } from "react"
import { createRoot } from "react-dom/client"
import type { PermissionRequest, QuestionRequest, SessionSummary } from "@remotty/protocol"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SessionDetail } from "../src/features/session/components/SessionDetail"
import { retainedSessionState } from "../src/features/session/model/sessionState"
import type { SessionSubagent } from "../src/features/session/model/sessionTypes"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe("Native conversation commands", () => {
  let container: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  const request = vi.fn(async () => [])
  const sessionKey = "commands:session"
  const renderSession = async (status: SessionSummary["status"] = "busy", permission?: PermissionRequest, question?: QuestionRequest, subagents: SessionSubagent[] = []) => {
    await act(async () => root.render(<SessionDetail
      session={{ id: "session", title: "Review cache behavior", directory: "/project", branch: "journal", status, updatedAt: 1, additions: 0, deletions: 0, files: 0 }}
      sessionKey={sessionKey} agents={[{ name: "build" }, { name: "plan" }]}
      revision={0} resourceRevisions={{ messages: 0, todos: 0, diffs: 0 }}
      subagents={subagents} subagentRevisions={{}} request={request} permission={permission} question={question} supportsSubagents={subagents.length === 0}
      loadCache={async () => undefined} saveCache={async () => {}}
      onBack={vi.fn()} onError={vi.fn()} onPromptFocused={vi.fn()}
    />))
  }
  beforeEach(async () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1 })
    vi.stubGlobal("cancelAnimationFrame", vi.fn())
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
    request.mockClear()
    retainedSessionState.clear()
    retainedSessionState.write(sessionKey, {
      draft: "Keep this instruction", refreshed: { messages: 0, todos: 0 },
      messageCache: { version: 2, canonical: { manifest: [], records: {}, syncedAt: 0 }, staged: { records: {} }, local: { messages: [] } },
    })
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    await renderSession()
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    retainedSessionState.clear()
    vi.unstubAllGlobals()
  })

  it("selects the prompt agent from the dock and sends with that agent", async () => {
    expect(container.querySelector(".detail-header .agent-picker")).toBeNull()
    const picker = container.querySelector<HTMLButtonElement>('.command-bar .agent-picker')!
    await act(async () => picker.click())
    const option = [...document.querySelectorAll<HTMLButtonElement>('[role=option]')].find((item) => item.textContent === "plan")!
    await act(async () => option.click())
    expect(document.querySelector('[role=listbox]')).toBeNull()
    expect(document.activeElement).toBe(picker)
    await act(async () => container.querySelector<HTMLFormElement>(".composer")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })))
    expect(request).toHaveBeenCalledWith({ type: "session.prompt", sessionId: "session", text: "Keep this instruction", agent: "plan" })
  })

  it("exposes an icon-only Stop agent control and aborts the session", async () => {
    const stop = container.querySelector<HTMLButtonElement>('[aria-label="Stop agent"]')!
    expect(stop.title).toBe("Stop agent")
    expect(stop.textContent).toBe("")
    expect(stop.querySelector(".lucide-circle-stop")).not.toBeNull()
    await act(async () => stop.click())
    expect(request).toHaveBeenCalledWith({ type: "session.abort", sessionId: "session" })
  })

  it("does not relabel historical responses when the prompt agent changes", async () => {
    await act(async () => root.unmount())
    const messages = [
      { info: { id: "plan", role: "assistant", agent: "plan" }, parts: [{ type: "text", text: "Plan recorded" }] },
      { info: { id: "build", role: "assistant", agent: "build" }, parts: [{ type: "text", text: "Build recorded" }] },
      { info: { id: "legacy", role: "assistant" }, parts: [{ type: "text", text: "Legacy recorded" }] },
    ]
    retainedSessionState.write(sessionKey, { messages, messageCache: {
      version: 2, canonical: { manifest: messages.map((message) => ({ id: message.info.id, fingerprint: message.info.id })), records: Object.fromEntries(messages.map((message) => [message.info.id, { message, fingerprint: message.info.id }])), syncedAt: 0 }, staged: { records: {} }, local: { messages: [] },
    } })
    root = createRoot(container)
    await renderSession("idle")
    const bylines = () => [...container.querySelectorAll(".entry-byline strong")].map((entry) => entry.textContent)
    expect(bylines()).toEqual(["plan", "build", "OpenCode"])
    await act(async () => container.querySelector<HTMLButtonElement>(".agent-picker")!.click())
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>("[role=option]")].find((option) => option.textContent === "plan")!.click())
    expect(bylines()).toEqual(["plan", "build", "OpenCode"])
  })

  it.each(["busy", "retry"] as const)("signals an older %s child outside the three visible entries on every tab", async (status) => {
    const children: SessionSubagent[] = [status, "idle", "error", "idle"].map((status, index) => ({ id: `child${index}`, status: status as SessionSubagent["status"], title: `Child ${index}`, updatedAt: index, workspaceId: "commands", parentSessionId: "session", rootSessionId: "session", directory: "/project", additions: 0, deletions: 0, files: 0 }))
    await renderSession("idle", undefined, undefined, children)
    const tab = container.querySelector<HTMLButtonElement>("#session-view-subagents-tab")!
    expect(tab.dataset.working).toBe("true")
    expect(tab.getAttribute("aria-label")).toBe("Subagents, agents working, 3")
    expect(tab.textContent).toBe("Subagents 3")
    expect(tab.hasAttribute("aria-busy")).toBe(false)
    await act(async () => tab.click())
    expect(tab.dataset.working).toBe("true")
    expect(container.querySelectorAll(".subagent-pill")).toHaveLength(3)
    expect(container.querySelector(".subagent-list")?.textContent).not.toContain("Child 0")
    await renderSession("idle", undefined, undefined, children.map((child) => ({ ...child, status: "idle" })))
    expect(tab.hasAttribute("data-working")).toBe(false)
    expect(tab.hasAttribute("aria-label")).toBe(false)
  })

  it("retains Enter submission, Shift+Enter and composition semantics in the pill input", async () => {
    const input = container.querySelector<HTMLTextAreaElement>('.composer textarea')!
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true })))
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true })))
    expect(request).not.toHaveBeenCalled()
    expect(input.value).toBe('Keep this instruction')
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })))
    expect(request).toHaveBeenCalledWith({ type: 'session.prompt', sessionId: 'session', text: 'Keep this instruction', agent: 'build' })
    expect(input.value).toBe('')
    expect(input.style.height).toBe('44px')
  })

  it("places both pending request panels above accessories and preserves them on Subagents", async () => {
    await renderSession('busy', { id: 'permission', sessionID: 'session', permission: 'bash', patterns: ['pnpm test'], metadata: {} }, { id: 'question', sessionID: 'session', questions: [{ header: 'Review', question: 'What next?', options: [{ label: 'Keyboard', description: 'Check input' }] }] })
    const stack = container.querySelector('.request-stack')!
    expect(stack.querySelector('.permission-panel')).not.toBeNull()
    expect(stack.querySelector('.question-panel')).not.toBeNull()
    expect([...container.querySelector('.session-dock')!.children].map((child) => child.className)).toEqual(['request-stack', 'command-bar', 'composer', 'session-tools'])
    await act(async () => container.querySelector<HTMLButtonElement>('#session-view-subagents-tab')!.click())
    expect(container.querySelector('.request-stack')).toBe(stack)
    expect(container.querySelector('.agent-picker')).toBeNull()
    expect(container.querySelector('[title="Stop agent"]')).not.toBeNull()
  })

  it.each(["busy", "retry", "idle", "error"] as const)("marks the %s header pill's activity independently of attention", async (status) => {
    await renderSession(status)
    const active = String(status === "busy" || status === "retry")
    expect(container.querySelector(".session-header-pill")?.getAttribute("data-active")).toBe(active)
    await renderSession(status, { id: "permission", sessionID: "session", permission: "bash", patterns: ["pwd"], metadata: {} })
    expect(container.querySelector(".detail-header")?.getAttribute("data-status")).toBe("needs-input")
    expect(container.querySelector('.detail-header [role="status"]')?.textContent).toBe("Needs attention")
    expect(container.querySelector(".session-header-pill")?.getAttribute("data-active")).toBe(active)
  })

  it("keeps the bottom tabs after the composer in reading order and exposes full context", () => {
    expect(container.querySelector('.detail-header')?.getAttribute("data-status")).toBe("busy")
    expect(container.querySelector('.detail-header [role="status"]')?.textContent).toBe("Working")
    expect(container.querySelector('.detail-header [role="status"]')?.getAttribute("aria-atomic")).toBe("true")
    expect(container.querySelector('.detail-header .status-dot')).toBeNull()
    expect(container.querySelector('.detail-header [role="status"]')?.classList.contains("sr-only")).toBe(true)
    expect(container.querySelector('.command-progress')).toBeNull()
    const composer = container.querySelector(".composer")!
    expect([...container.querySelector('.session-dock')!.children].map((child) => child.className)).toEqual(['command-bar', 'composer', 'session-tools'])
    const tabs = container.querySelector('[role=tablist]')!
    expect(composer.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(container.querySelectorAll('[role=tab][tabindex="0"]')).toHaveLength(1)
    expect(container.querySelector("#session-context-description")?.textContent).toContain("/project")
    expect(container.querySelector("#session-context-description")?.textContent).toContain("journal")
    expect(container.querySelector('[role=tab][aria-selected="true"]')?.textContent).toBe("Activity")
  })

  it("shows folder then branch without a disclosure on every root tab", async () => {
    for (const tab of ["activity", "todos", "changes"]) {
      await act(async () => container.querySelector<HTMLButtonElement>(`#session-view-${tab}-tab`)!.click())
      expect(container.querySelector(".detail-header details, .detail-header summary")).toBeNull()
      const location = container.querySelector(".session-location")!
      expect([...location.children].map((child) => child.className)).toEqual(["session-folder", "session-branch"])
      expect(location.querySelector(".session-folder")?.getAttribute("title")).toBe("/project")
      expect(location.querySelector(".session-branch")?.getAttribute("aria-label")).toBe("Branch: journal")
      expect(location.querySelectorAll("svg[aria-hidden=true]")).toHaveLength(2)
      expect(container.querySelector("h2")?.getAttribute("aria-describedby")).toBe("session-context-description")
    }
  })

  it("keeps Stop reachable in subagents and restores the draft on returning to Activity", async () => {
    const tabs = container.querySelector('[role=tablist]')!
    expect(tabs.getAttribute("aria-orientation")).toBe("horizontal")
    const first = tabs.querySelector<HTMLButtonElement>('[role=tab]')!
    await act(async () => first.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })))
    expect(document.activeElement?.textContent).toContain("Subagents")
    expect(container.querySelector(".composer")).toBeNull()
    expect([...container.querySelector('.session-dock')!.children].map((child) => child.className)).toEqual(['command-bar', 'session-tools'])
    expect(container.querySelector('[role=tabpanel]')?.getAttribute("aria-labelledby")).toBe("session-view-subagents-tab")
    await act(async () => container.querySelector<HTMLButtonElement>('.command-bar [title="Stop agent"]')!.click())
    expect(request).toHaveBeenCalledWith({ type: "session.abort", sessionId: "session" })
    expect(container.querySelector(".detail-header")).toBeNull()
    expect(container.textContent).not.toContain("Back to Activity")
    await act(async () => first.click())
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("Keep this instruction")
  })
})
