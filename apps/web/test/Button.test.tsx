import { createRef } from "react"
import { readFile } from "node:fs/promises"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { Button, IconButton, buttonClassName } from "../src/Button"

describe("Button", () => {
  it("uses button semantics and merges variant and size classes", () => {
    const markup = renderToStaticMarkup(<Button variant="primary" size="sm" className="contextual">Save</Button>)
    expect(markup).toContain('type="button"')
    expect(markup).toContain('class="ui-button ui-button--primary ui-button--sm contextual"')
    expect(buttonClassName("danger", "icon", "toast-dismiss")).toBe("ui-button ui-button--danger ui-button--icon toast-dismiss")
  })

  it("disables and marks only loading buttons busy while preserving a label", () => {
    const markup = renderToStaticMarkup(<Button loading loadingLabel="Updating" startIcon={<i />}>Update now</Button>)
    expect(markup).toContain("disabled=\"\"")
    expect(markup).toContain('aria-busy="true"')
    expect(markup).toContain("Updating")
    expect(markup).toContain("lucide-loader-circle")
    expect(markup).not.toContain("<i")
  })

  it("gives icon buttons a label and matching title", () => {
    const markup = renderToStaticMarkup(<IconButton aria-label="Close dialog" icon={<i />} />)
    expect(markup).toContain('aria-label="Close dialog"')
    expect(markup).toContain('title="Close dialog"')
    expect(markup).toContain("ui-button--icon")
  })

  it("accepts HTML button refs", () => {
    const ref = createRef<HTMLButtonElement>()
    renderToStaticMarkup(<Button ref={ref}>Ref target</Button>)
  })

  it("keeps specialized ARIA and layout widgets as native buttons", async () => {
    const [app, subagentActivity] = await Promise.all([
      readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
      readFile(new URL("../src/SubagentActivity.tsx", import.meta.url), "utf8"),
    ])
    expect(app).toContain('className="connection-button"')
    expect(app).toContain('className={`notification-button ${relayState.notificationsEnabled ? "enabled" : ""}`}')
    expect(app).toContain('className="pwa-update-affordance"')
    expect(app).toContain('className="workspace-heading"')
    expect(app).toContain('role="tab"')
    expect(app).toContain('className="question-title"')
    expect(app).toContain('className="agent-picker"')
    expect(app).toContain('type="submit" className="grid size-12')
    expect(subagentActivity).toContain("<button key={item.id}")
  })
})
