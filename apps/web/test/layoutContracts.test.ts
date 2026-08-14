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
    expect(app).toContain("Subagents <span>{subagents.length}</span>")
    expect(app).toContain("if (group) group.push(session)")
    expect(app).toContain("messageRefreshGenerationRef")
    expect(app).toContain("todosRefreshGenerationRef")
    expect(app).toContain("const selectTab")
    expect(app).toContain("followOutputRef.current = true")
    expect(app).toContain("lastScrollTopRef.current = detailContentRef.current.scrollTop")
    expect((app.match(/lastScrollTopRef\.current = detailContentRef\.current\.scrollTop/g) ?? [])).toHaveLength(2)
  })

  it("keeps progress draining bounded by a timeout", () => {
    const relay = source("../src/useRelay.ts")
    expect(relay).toContain("Message progress timed out.")
    expect(relay).toContain("verifiedMessageIds")
  })
})
