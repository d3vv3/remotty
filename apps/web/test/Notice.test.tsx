/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ErrorToast, WarningNotice } from "../src/components/ui"
import { Changes } from "../src/features/session/components/Changes"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe("shared notices", () => {
  let container: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  beforeEach(() => { container = document.createElement("div"); document.body.append(container); root = createRoot(container) })
  afterEach(async () => { await act(async () => root.unmount()); container.remove() })

  it("announces complete warning updates and hides the leading icon from assistive technology", async () => {
    await act(async () => root.render(<WarningNotice className="activity-warning">Activity refresh failed: Offline</WarningNotice>))
    const notice = container.querySelector('[role="status"]')!
    expect(notice.textContent).toBe("Activity refresh failed: Offline")
    expect(notice.getAttribute("aria-atomic")).toBe("true")
    expect(notice.classList.contains("activity-warning")).toBe(true)
    expect(notice.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true")
    expect(notice.querySelector("svg")?.classList.contains("lucide-triangle-alert")).toBe(true)
    await act(async () => root.render(<WarningNotice>Activity refresh failed: Connection timed out</WarningNotice>))
    expect(notice.textContent).toBe("Activity refresh failed: Connection timed out")
  })

  it("preserves multiline and unbroken error text and exposes a working dismiss button", async () => {
    const message = `Request failed:\n${"workspace/".repeat(120)}`
    const dismiss = vi.fn()
    await act(async () => root.render(<ErrorToast message={message} onDismiss={dismiss} />))
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1)
    expect(container.querySelector(".ui-notice-content")?.textContent).toBe(message)
    const button = container.querySelector<HTMLButtonElement>('button[aria-label="Dismiss error"]')!
    expect(button.type).toBe("button")
    await act(async () => button.click())
    expect(dismiss).toHaveBeenCalledOnce()
  })

  it("retains changes truncation and failure states in shared notices", async () => {
    await act(async () => root.render(<Changes diffs={[]} state="error" truncated version={0} directory="/workspace" sessionId="root" request={vi.fn()} onError={vi.fn()} />))
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Some files were omitted because the workspace contains more than 500 changes.")
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Workspace changes could not be loaded.")
  })
})
