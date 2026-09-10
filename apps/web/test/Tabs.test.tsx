/** @vitest-environment jsdom */

import { act, useState } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Tabs } from "../src/components/ui"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function Fixture() {
  const [value, setValue] = useState<"one" | "two" | "three">("one")
  return <>
    <Tabs id="test" label="Views" value={value} onChange={setValue} options={[{ value: "one", label: "One", panelId: "panel" }, { value: "two", label: "Two", panelId: "panel" }, { value: "three", label: "Three", panelId: "panel" }]} />
    <div id="panel" role="tabpanel" aria-labelledby={`test-${value}-tab`}>{value}</div>
  </>
}

describe("Tabs", () => {
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

  it("links panels and moves selection with arrows, Home, and End", async () => {
    await act(async () => root.render(<Fixture />))
    const tabs = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1])
    expect(tabs[0]?.getAttribute("aria-controls")).toBe("panel")

    tabs[0]!.focus()
    await act(async () => tabs[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })))
    expect(tabs[1]?.getAttribute("aria-selected")).toBe("true")
    expect(document.activeElement).toBe(tabs[1])

    await act(async () => tabs[1]!.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })))
    expect(tabs[2]?.getAttribute("aria-selected")).toBe("true")
    await act(async () => tabs[2]!.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })))
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("true")
  })
})
