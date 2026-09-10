/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import { useVisualViewport } from "../src/hooks/useVisualViewport"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

it("follows keyboard resize and viewport panning, ignores pinch zoom, and cleans up", async () => {
  const viewport = Object.assign(new EventTarget(), { height: 640, offsetTop: 0, scale: 1 })
  const remove = vi.spyOn(viewport, "removeEventListener")
  vi.stubGlobal("visualViewport", viewport)
  const container = document.createElement("div")
  const root = createRoot(container)
  function Screen() { return <main style={useVisualViewport()} /> }
  try {
    await act(async () => root.render(<Screen />))
    const style = container.querySelector("main")!.style
    expect(style.getPropertyValue("--viewport-height")).toBe("640px")
    await act(async () => { viewport.height = 360; viewport.dispatchEvent(new Event("resize")) })
    expect(style.getPropertyValue("--viewport-height")).toBe("360px")
    await act(async () => { viewport.offsetTop = 24; viewport.dispatchEvent(new Event("scroll")) })
    expect(style.getPropertyValue("--viewport-top")).toBe("24px")
    await act(async () => { viewport.scale = 2; viewport.height = 180; viewport.dispatchEvent(new Event("resize")) })
    expect(style.getPropertyValue("--viewport-height")).toBe("360px")
    await act(async () => { viewport.scale = 1; viewport.height = 320; viewport.offsetTop = 18; viewport.dispatchEvent(new Event("resize")) })
    expect(style.getPropertyValue("--viewport-height")).toBe("320px")
    expect(style.getPropertyValue("--viewport-top")).toBe("18px")
    await act(async () => { viewport.height = 380; viewport.dispatchEvent(new Event("resize")) })
    expect(style.getPropertyValue("--viewport-height")).toBe("380px")
    await act(async () => { viewport.height = 640; viewport.offsetTop = 0; viewport.dispatchEvent(new Event("resize")) })
    expect(style.getPropertyValue("--viewport-height")).toBe("640px")
    expect(style.getPropertyValue("--viewport-top")).toBe("0px")
  } finally {
    await act(async () => root.unmount())
    expect(remove.mock.calls.map(([event]) => event)).toEqual(["resize", "scroll"])
    vi.unstubAllGlobals()
  }
})

it("leaves dynamic viewport CSS in control when the visual viewport API is unavailable", async () => {
  vi.stubGlobal("visualViewport", undefined)
  const container = document.createElement("div")
  const root = createRoot(container)
  function Screen() { return <main style={useVisualViewport()} /> }
  try {
    await act(async () => root.render(<Screen />))
    expect(container.querySelector("main")!.style.length).toBe(0)
  } finally {
    await act(async () => root.unmount())
    vi.unstubAllGlobals()
  }
})
