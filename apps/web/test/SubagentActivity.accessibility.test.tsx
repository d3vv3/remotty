import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { SubagentActivity } from "../src/features/session/components/SubagentActivity"
import { retainedSessionState } from "../src/features/session/model/sessionState"

describe("SubagentActivity accessibility", () => {
  it("exposes child selection and meaningful status labels", () => {
    const markup = renderToStaticMarkup(<SubagentActivity
      subagents={[
        { id: "active", title: "Active child (@explore subagent)", agent: "explore", status: "busy", parentSessionId: "root", updatedAt: 2, workspaceId: "workspace" },
        { id: "retry", title: "Retry child", agent: "review", status: "retry", parentSessionId: "root", updatedAt: 3, workspaceId: "workspace" },
        { id: "done", title: "Done child", status: "idle", parentSessionId: "root", updatedAt: 1, workspaceId: "workspace" },
      ]}
      selectedChildId="active"
      onSelect={vi.fn()}
      request={vi.fn()}
      revisions={{}}
    />)

    expect(markup).toContain('aria-pressed="true"')
    expect(markup).toContain('aria-pressed="false"')
    expect(markup).toContain('aria-label="Active child . explore . Working"')
    expect(markup).toContain('aria-label="Done child . Subagent . Ready"')
    expect(markup).toContain('title="Active child"')
    expect(markup).not.toContain("(@explore subagent)")
    expect(markup).toMatch(/class="lucide lucide-bot"[^>]*aria-hidden="true"/)
    expect(markup).toContain('aria-label="Retry child . review . Retrying"')
    expect(markup).not.toContain('class="subagent-status busy"')
    expect(markup).not.toContain('class="subagent-status retry"')
    const pillText = [...markup.matchAll(/<button\b[^>]*>(.*?)<\/button>/g)].map(([, content]) => content!.replace(/<[^>]*>/g, "")).join(" ")
    expect(pillText).not.toMatch(/Working|Retrying/)
    expect(pillText).toContain("Active child")
    expect(pillText).toContain("explore")
    expect(pillText).toContain("review")
    expect(markup).toContain('class="subagent-status idle"')
    expect(markup).not.toContain("parent root")
  })

  it("renders cached child activity with journal bylines, Markdown, and expandable tools", () => {
    retainedSessionState.write("workspace:child", { messages: [{ info: { id: "message", role: "assistant", time: { created: 1 } }, parts: [
      { type: "text", text: "**Verified** the child session." },
      { type: "tool", tool: "read", state: { title: "Read component", status: "completed", input: { path: "component.tsx" }, output: "export const ready = true" } },
    ] }] })
    try {
      const markup = renderToStaticMarkup(<SubagentActivity subagents={[{ id: "child", title: "Review", status: "idle", parentSessionId: "root", updatedAt: 1, workspaceId: "workspace" }]} onSelect={vi.fn()} request={vi.fn()} revisions={{}} />)
      expect(markup).toContain('class="entry-byline"')
      expect(markup).toContain("<strong>Verified</strong>")
      expect(markup).toContain('class="tool-details"')
      expect(markup).toContain("component.tsx")
      expect(markup).toContain("export const ready = true")
    } finally { retainedSessionState.clear() }
  })
})
