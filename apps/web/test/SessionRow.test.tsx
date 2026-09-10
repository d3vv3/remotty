/** @vitest-environment jsdom */
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { SessionRow } from "../src/features/workspace/SessionRow"

describe("SessionRow status presentation", () => {
  it.each([
    ["busy", false, false, "busy", "Working", false],
    ["retry", false, false, "retry", "Retrying", true],
    ["idle", false, false, "idle", "Ready", false],
    ["error", false, false, "error", "Error", true],
    ["busy", true, false, "needs-input", "Needs input", true],
    ["idle", true, false, "needs-input", "Needs input", true],
    ["busy", true, true, "error", "Workspace offline", true],
    ["idle", false, true, "error", "Workspace offline", true],
  ] as const)("presents %s, attention=%s offline=%s", (status, needsInput, offline, state, label, visible) => {
    const container = document.createElement("div")
    container.innerHTML = renderToStaticMarkup(<SessionRow session={{ id: "test", title: "Review", directory: "/test", updatedAt: Date.now(), status, additions: 0, deletions: 0, files: 0 }} needsInput={needsInput} offline={offline} selected onSelect={() => {}} />)
    expect(container.querySelector("button")?.getAttribute("aria-label")).toBe(`Review, ${label}`)
    expect(container.querySelector("button")?.getAttribute("aria-current")).toBe("true")
    expect(container.querySelector(".session-avatar")?.className).toBe(`session-avatar ${state}`)
    expect(container.querySelector(".session-avatar .lucide-message-square")).not.toBeNull()
    expect(container.textContent?.includes(label)).toBe(visible)
    expect(container.querySelector(".attention") !== null).toBe(needsInput && !offline)
  })
})
