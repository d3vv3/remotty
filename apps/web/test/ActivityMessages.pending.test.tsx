/** @vitest-environment jsdom */

import { act } from "react"
import { createRoot } from "react-dom/client"
import { webcrypto } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SessionDetail } from "../src/features/session/components/SessionDetail"
import { SubagentActivity } from "../src/features/session/components/SubagentActivity"
import { retainedSessionState } from "../src/features/session/model/sessionState"
import type { SessionMessage } from "../src/features/session/model/sessionContent"
import { ActivityMessages } from "../src/features/session/components/ActivityMessages"
import { activityPresentation } from "../src/features/session/model/activityPresentation"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe.each(["primary", "subagent"] as const)("%s pending responses", (view) => {
  let container: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  const key = "pending:session"
  const request = vi.fn()
  const loadCache = vi.fn(async () => undefined)
  const saveCache = vi.fn(async () => {})
  const onError = vi.fn()
  const pending = () => container.querySelectorAll('[role=status][aria-label="OpenCode is working"]')
  const render = async (status: "idle" | "busy" | "retry" | "error", revision = 0) => {
    await act(async () => root.render(view === "primary" ? <SessionDetail
      session={{ id: "session", title: "Pending test", directory: "/project", status, updatedAt: 1, additions: 0, deletions: 0, files: 0 }}
      sessionKey={key} agents={[{ name: "build" }]} revision={0} resourceRevisions={{ messages: revision, todos: 0, diffs: 0 }}
      subagents={[]} subagentRevisions={{}} request={request} loadCache={loadCache} saveCache={saveCache}
      onBack={vi.fn()} onError={onError} onPromptFocused={vi.fn()}
    /> : <SubagentActivity subagents={[{ id: "session", workspaceId: "pending", title: "Pending test", status, parentSessionId: "root", updatedAt: 1 }]} onSelect={vi.fn()} request={request} revisions={{ session: revision }} />))
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
  }
  const seed = (messages: SessionMessage[]) => retainedSessionState.write(key, {
    messages, refreshed: { messages: 0 },
    messageCache: { version: 2, canonical: {
      manifest: messages.map((message) => ({ id: message.info.id, fingerprint: message.info.id })),
      records: Object.fromEntries(messages.map((message) => [message.info.id, { message, fingerprint: message.info.id }])), syncedAt: 0,
    }, staged: { records: {} }, local: { messages: [] } },
  })
  beforeEach(() => {
    retainedSessionState.clear()
    request.mockReset().mockResolvedValue([])
    saveCache.mockClear()
    onError.mockClear()
    // Return the digest in jsdom's ArrayBuffer realm, as browser WebCrypto does.
    vi.stubGlobal("crypto", { randomUUID: () => webcrypto.randomUUID(), subtle: {
      digest: async (algorithm: string, data: Uint8Array) => {
        const digest = new Uint8Array(await webcrypto.subtle.digest(algorithm, data))
        const buffer = new ArrayBuffer(digest.byteLength)
        new Uint8Array(buffer).set(digest)
        return buffer
      },
    } })
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1 })
    vi.stubGlobal("cancelAnimationFrame", vi.fn())
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    retainedSessionState.clear()
    vi.unstubAllGlobals()
  })

  it.each([
    { label: "user prompt", role: "user", parts: [{ type: "text", text: "Please review" }], responses: 1 },
    { label: "assistant text", role: "assistant", parts: [{ type: "text", text: "Reviewing" }], responses: 2 },
    { label: "tool output", role: "assistant", parts: [{ type: "tool", tool: "read", state: { output: "file contents" } }], responses: 2 },
    { label: "empty assistant", role: "assistant", parts: [], responses: 1 },
    { label: "blank assistant text", role: "assistant", parts: [{ type: "text", text: "  " }], responses: 1 },
    { label: "reasoning assistant", role: "assistant", parts: [{ type: "reasoning", text: "private" }], responses: 1 },
  ])("reuses or appends a single pending response after $label", async ({ role, parts, responses }) => {
    const messages = [{ info: { id: "last", role }, parts }]
    seed(messages)
    await render("busy")
    expect(pending()).toHaveLength(1)
    expect(container.querySelectorAll('article[aria-label="OpenCode response"]')).toHaveLength(responses)
    expect(container.querySelectorAll(".message-time")).toHaveLength(0)
    expect(container.querySelector(".command-progress")).toBeNull()
    if (view === "primary") {
      expect(container.querySelector('.command-bar [title="Stop agent"]')).not.toBeNull()
      expect(container.querySelector(".command-bar .agent-picker")).not.toBeNull()
      expect(container.querySelector(".session-status")?.textContent).toBe("Working")
    }
    await render("retry")
    expect(pending()).toHaveLength(1)
    await render("idle")
    expect(pending()).toHaveLength(0)
    await render("error")
    expect(pending()).toHaveLength(0)
    expect(retainedSessionState.read(key)?.messages).toEqual(messages)
    expect(saveCache).not.toHaveBeenCalled()
  })

  it("reuses the trailing empty assistant after tools and retains history after invalid refreshes", async () => {
    const messages: SessionMessage[] = [
      { info: { id: "tool", role: "assistant" }, parts: [{ type: "tool", tool: "read", state: { output: "Existing output" } }] },
      { info: { id: "empty", role: "assistant" }, parts: [] },
    ]
    seed(messages)
    await render("busy")
    expect(pending()).toHaveLength(1)
    expect(container.querySelectorAll('article[aria-label="OpenCode response"]')).toHaveLength(2)
    request.mockResolvedValueOnce({ invalid: true })
    await render("busy", 1)
    expect(pending()).toHaveLength(0)
    expect(container.textContent).toContain("Existing output")
    expect(retainedSessionState.read(key)?.messages).toEqual(messages)
  })

  it("waits for initial activity, suppresses failed refresh progress, and recovers", async () => {
    let resolve!: (value: unknown) => void
    request.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    await render("busy")
    expect(pending()).toHaveLength(0)
    await act(async () => resolve([]))
    await vi.waitFor(async () => {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
      expect(onError.mock.calls).toEqual([])
      expect(pending()).toHaveLength(1)
    })
    request.mockRejectedValueOnce(new Error("Activity unavailable"))
    await render("busy", 1)
    expect(pending()).toHaveLength(0)
    request.mockResolvedValueOnce([{ info: { id: "tool", role: "assistant" }, parts: [{ type: "tool", tool: "read", state: { output: "Done" } }] }])
    await render("retry", 2)
    expect(pending()).toHaveLength(1)
    expect(container.querySelectorAll(".tool-details")).toHaveLength(1)
    expect(container.querySelectorAll('article[aria-label="OpenCode response"]')).toHaveLength(2)
    request.mockResolvedValueOnce([{ info: { id: "reply", role: "assistant" }, parts: [{ type: "text", text: "Finished" }] }])
    await render("idle", 3)
    expect(pending()).toHaveLength(0)
    expect(container.textContent).toContain("Finished")
  })

  it("places the queued icon after You and time, and clears it for hidden processing parts", async () => {
    const prompt: SessionMessage = { info: { id: "prompt", role: "user", time: { created: 1 } }, parts: [{ type: "text", text: "Please review" }] }
    await act(async () => root.render(<ActivityMessages presentation={activityPresentation([prompt], "idle", false, false)} />))
    const byline = container.querySelector(".entry-byline")!
    expect([...byline.children].map((child) => child.tagName)).toEqual(["STRONG", "TIME", "SPAN"])
    const queued = byline.querySelector('[role=status][aria-label="Queued"]')!
    expect(queued.getAttribute("title")).toBe("Queued")
    expect(queued.querySelector("svg")).not.toBeNull()
    expect(queued.textContent).toBe("")
    const processing: SessionMessage = { info: { id: "answer", role: "assistant", parentID: "prompt" }, parts: [{ type: "reasoning", text: "Internal" }] }
    await act(async () => root.render(<ActivityMessages showToolCalls={false} presentation={activityPresentation([prompt, processing], "idle", false, false)} />))
    expect(container.querySelector('[aria-label="Queued"]')).toBeNull()
  })

  if (view === "primary") it("keeps the submitted prompt queued from acknowledgement through refresh and clears it on processing", async () => {
    seed([])
    retainedSessionState.write(key, { draft: "Review this change" })
    await render("busy")
    let acknowledge!: (value: unknown) => void
    request.mockImplementationOnce(() => new Promise((resolve) => { acknowledge = resolve }))
    await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })) })
    expect(container.querySelector('[aria-label="Sending"]')).not.toBeNull()
    await act(async () => acknowledge({ messageId: "msg_prompt" }))
    expect(container.querySelector('[aria-label="Queued"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="Sending"]')).toBeNull()
    const canonical: SessionMessage = { info: { id: "msg_prompt", role: "user" }, parts: [{ type: "text", text: "Review this change" }] }
    request.mockResolvedValueOnce([canonical])
    await render("busy", 1)
    expect(container.querySelectorAll('[aria-label="Your message"]')).toHaveLength(1)
    expect(container.querySelector('[aria-label="Queued"]')).not.toBeNull()
    expect((retainedSessionState.read(key)?.messages as SessionMessage[])[0]!.info.delivery).toBeUndefined()
    request.mockResolvedValueOnce([canonical, { info: { id: "msg_processing", role: "assistant", parentID: "msg_prompt" }, parts: [] }])
    await render("busy", 2)
    expect(container.querySelector('[aria-label="Queued"]')).toBeNull()
    expect(pending()).toHaveLength(1)
  })

  it.each([ ["sending", "Sending"], ["uncertain", "Delivery uncertain"], ["failed", "Delivery failed"] ] as const)("retains the %s label", async (delivery, label) => {
    const prompt: SessionMessage = { info: { id: "prompt", role: "user", delivery }, parts: [{ type: "text", text: "Review" }] }
    await act(async () => root.render(<ActivityMessages presentation={activityPresentation([prompt], "idle", false, false)} />))
    expect(container.querySelector(`[role=status][aria-label="${label}"]`)?.textContent).toBe(label)
    expect(container.querySelector('[aria-label="Queued"]')).toBeNull()
  })
})
