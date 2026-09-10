/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import { useHorizontalOverflow } from "../src/features/session/hooks/useHorizontalOverflow"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

it("tracks right overflow across scrolling, viewport/content resize and replacement, and cleans up", async () => {
  let measure = () => {}
  const observe = vi.fn()
  const disconnect = vi.fn()
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { measure = callback }
    observe = observe
    disconnect = disconnect
  })
  const container = document.createElement("div")
  const root = createRoot(container)
  function Row({ contentKey }: { contentKey: string }) {
    const { scrollRef, hasOverflowRight } = useHorizontalOverflow(contentKey)
    return <div data-overflow-right={hasOverflowRight} ref={scrollRef}><button key={contentKey}>{contentKey}</button></div>
  }
  const removeWindowListener = vi.spyOn(window, "removeEventListener")
  let removeScrollListener: ReturnType<typeof vi.spyOn> | undefined
  try {
    await act(async () => root.render(<Row contentKey="first" />))
    const row = container.firstElementChild as HTMLDivElement
    removeScrollListener = vi.spyOn(row, "removeEventListener")
    expect(row.dataset.overflowRight).toBe("false")
    let width = 300
    let contentWidth = 800
    Object.defineProperties(row, {
      clientWidth: { get: () => width },
      scrollWidth: { get: () => contentWidth },
    })
    await act(async () => measure())
    expect(row.dataset.overflowRight).toBe("true")
    expect(observe).toHaveBeenCalledWith(row)
    expect(observe).toHaveBeenCalledWith(row.firstElementChild)
    await act(async () => { row.scrollLeft = 499.5; row.dispatchEvent(new Event("scroll")) })
    expect(row.dataset.overflowRight).toBe("false")
    await act(async () => { row.scrollLeft = 200; row.dispatchEvent(new Event("scroll")) })
    expect(row.dataset.overflowRight).toBe("true")
    await act(async () => { width = 800; window.dispatchEvent(new Event("resize")) })
    expect(row.dataset.overflowRight).toBe("false")
    await act(async () => { contentWidth = 1200; measure() })
    expect(row.dataset.overflowRight).toBe("true")
    contentWidth = 300
    await act(async () => root.render(<Row contentKey="replacement" />))
    expect(row.dataset.overflowRight).toBe("false")
    expect(observe).toHaveBeenCalledWith(row.firstElementChild)
    expect(disconnect).toHaveBeenCalledTimes(1)
  } finally {
    await act(async () => root.unmount())
    expect(disconnect).toHaveBeenCalledTimes(2)
    expect(removeScrollListener).toHaveBeenCalledWith("scroll", expect.any(Function))
    expect(removeWindowListener).toHaveBeenCalledWith("resize", expect.any(Function))
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  }
})
