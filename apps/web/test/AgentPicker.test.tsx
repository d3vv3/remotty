/** @vitest-environment jsdom */

import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AgentPicker } from "../src/features/session/components/AgentPicker"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe("AgentPicker", () => {
  let container: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  let onChange: ReturnType<typeof vi.fn>
  const agents = [{ name: "build", description: "Build agent" }, { name: "plan", description: "Plan agent" }]

  beforeEach(async () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1 })
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    onChange = vi.fn()
    await act(async () => root.render(<AgentPicker agents={agents} value="build" onChange={onChange} />))
  })
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals() })

  it("opens and navigates options from the keyboard, then restores trigger focus", async () => {
    const trigger = container.querySelector<HTMLButtonElement>(".agent-picker")!
    await act(async () => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })))
    expect(document.querySelector("[role=listbox]")).not.toBeNull()
    expect(document.activeElement?.textContent).toContain("build")

    await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })))
    expect(document.activeElement?.textContent).toContain("plan")
    await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })))
    expect(onChange).toHaveBeenCalledWith("plan")
    expect(document.querySelector("[role=listbox]")).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it("dismisses with Escape and restores trigger focus", async () => {
    const trigger = container.querySelector<HTMLButtonElement>(".agent-picker")!
    await act(async () => trigger.click())
    await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })))
    expect(document.querySelector("[role=listbox]")).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it("colors the robot with the selected agent while retaining the readable name", async () => {
    for (const value of ["build", "plan"]) {
      await act(async () => root.render(<AgentPicker agents={[{ name: "build", color: "#123456" }, { name: "plan", color: "#654321" }]} value={value} onChange={onChange} />))
      const trigger = container.querySelector<HTMLButtonElement>(".agent-picker")!
      expect(trigger.style.getPropertyValue("--agent-color")).toBe(value === "build" ? "#123456" : "#654321")
      expect(trigger.querySelector<SVGElement>(".lucide-bot")?.style.color).toBe("var(--agent-color)")
      expect(trigger.getAttribute("aria-label")).toBe(`Agent ${value}`)
      expect(trigger.textContent).toBe(value)
    }
  })

  it("closes when pointer interaction moves outside", async () => {
    await act(async () => container.querySelector<HTMLButtonElement>(".agent-picker")!.click())
    expect(document.querySelector("[role=listbox]")).not.toBeNull()
    await act(async () => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })))
    expect(document.querySelector("[role=listbox]")).toBeNull()
  })
})
