/** @vitest-environment jsdom */

import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Field } from "../src/components/ui"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe("Field", () => {
  let container: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  beforeEach(() => {
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it("links hints and errors to the rendered control", async () => {
    await act(async () => root.render(<Field id="workspace" label="Workspace" hint="Folder" error="Unavailable">{(controlProps) => <select {...controlProps} id="workspace" />}</Field>))
    const control = container.querySelector("select")!
    expect(control.getAttribute("aria-describedby")).toBe("workspace-hint workspace-error")
    expect(control.getAttribute("aria-invalid")).toBe("true")
    expect(container.querySelector("#workspace-hint")?.textContent).toBe("Folder")
    expect(container.querySelector("#workspace-error")?.textContent).toBe("Unavailable")
  })
})
