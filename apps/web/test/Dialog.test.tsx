/** @vitest-environment jsdom */

import { act, StrictMode, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Dialog } from "../src/components/ui"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function Fixture({ busy = false }: { busy?: boolean }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  return <><button ref={triggerRef} onClick={() => setOpen(true)}>Open</button>{open && <Dialog labelledBy="dialog-title" onClose={() => setOpen(false)} busy={busy} restoreFocusRef={triggerRef}><h2 id="dialog-title">Dialog</h2><button>First</button><button>Last</button></Dialog>}</>
}

describe("Dialog", () => {
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
    vi.restoreAllMocks()
  })

  it("traps Tab, closes on Escape, and restores trigger focus", async () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { callback(0); return 1 })
    await act(async () => root.render(<Fixture />))
    const trigger = container.querySelector<HTMLButtonElement>("button")!
    await act(async () => trigger.click())
    const buttons = [...container.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')]
    expect(document.activeElement).toBe(buttons[0])

    buttons[1]!.focus()
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(buttons[0])

    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })))
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it("does not close a busy dialog with Escape or its backdrop", async () => {
    await act(async () => root.render(<Fixture busy />))
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click())
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })))
    const overlay = container.querySelector<HTMLElement>('[role="presentation"]')!
    await act(async () => overlay.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })))
    expect(container.querySelector('[role="dialog"]')).toBeTruthy()
  })

  it("does not let StrictMode cleanup restore focus over the next setup", async () => {
    const frames = new Map<number, FrameRequestCallback>()
    let nextFrame = 0
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      const id = ++nextFrame
      frames.set(id, callback)
      return id
    })
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => { frames.delete(id) })
    const outside = document.createElement("button")
    document.body.append(outside)
    outside.focus()

    await act(async () => root.render(<StrictMode><Dialog labelledBy="strict-title" onClose={() => undefined}><h2 id="strict-title">Strict dialog</h2><button>Inside</button></Dialog></StrictMode>))
    for (const callback of frames.values()) callback(0)

    expect(document.activeElement).toBe(container.querySelector('[role="dialog"] button'))
    frames.clear()
    await act(async () => root.render(<StrictMode />))
    for (const callback of frames.values()) callback(0)
    expect(document.activeElement).toBe(outside)
    outside.remove()
  })
})
