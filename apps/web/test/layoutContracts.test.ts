import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8")

describe("layout source contracts", () => {
  it("keeps connection details scrollable with fixed dialog chrome", () => {
    const css = source("../src/styles.css")
    const app = source("../src/App.tsx")
    expect(css).toContain("max-height: calc(100dvh - 36px)")
    expect(css).toContain(".connection-dialog-body { min-height: 0; overflow-y: auto; }")
    expect(css).toContain("grid-template-columns: minmax(0, 1fr) auto")
    expect(app).toContain('className="connection-dialog-body"')
  })

  it("keeps tabs mobile-scrollable and exposes the subagent tab contract", () => {
    const css = source("../src/styles.css")
    const app = source("../src/App.tsx")
    expect(css).toContain(".tabs { height: 46px; display: flex; gap: 6px; overflow-x: auto")
    expect(app).toContain("const visibleSubagentEntries = useMemo(() => visibleSubagents(subagents), [subagents])")
    expect(app).toContain("Subagents <span>{visibleSubagentEntries.length}</span>")
    expect(app).toContain("<SubagentActivity subagents={visibleSubagentEntries}")
    expect(app).toContain("if (group) group.push(session)")
    expect(app).toContain("messageRefreshGenerationRef")
    expect(app).toContain("todosRefreshGenerationRef")
    expect(app).toContain("const selectTab")
    expect(app).toContain("followOutputRef.current = true")
    expect(app).toContain("lastScrollTopRef.current = detailContentRef.current.scrollTop")
    expect((app.match(/lastScrollTopRef\.current = detailContentRef\.current\.scrollTop/g) ?? [])).toHaveLength(2)
  })

  it("hides the composer and root working strip for subagent activity while restoring output follow on Activity", () => {
    const app = source("../src/App.tsx")
    expect(app).toContain('const showComposer = tab !== "subagents"')
    expect(app).toContain("{showComposer && (session.status === \"busy\" || session.status === \"retry\")")
    expect(app).toContain('{showComposer && <form className="composer" onSubmit={submit}>')
    expect(app).toContain('if (next === "activity")')
    expect(app).toContain("detailContentRef.current.scrollTop = detailContentRef.current.scrollHeight")
  })

  it("keeps progress draining bounded by a timeout", () => {
    const relay = source("../src/useRelay.ts")
    expect(relay).toContain("Message progress timed out.")
    expect(relay).toContain("verifiedMessageIds")
  })
})
