/** @vitest-environment jsdom */
import { act, createRef } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Composer } from "../src/features/session/components/Composer"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe("Composer draft debounce", () => {
  let container: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  const onChange = vi.fn()
  const onDraftChange = vi.fn()
  const onSubmit = vi.fn((event: React.FormEvent, _value: string) => event.preventDefault())
  const promptRef = createRef<HTMLTextAreaElement>()
  const disconnect = vi.fn()
  const observe = vi.fn()
  const render = (value = "", reset?: { value: string }) => act(() => root.render(<Composer value={value} reset={reset} onChange={onChange} onDraftChange={onDraftChange} onSubmit={onSubmit} sending={false} disabled={false} idle promptRef={promptRef} />))
  const input = () => container.querySelector("textarea")!
  const edit = (value: string, caret = value.length) => act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input(), value)
    input().setSelectionRange(caret, caret)
    input().dispatchEvent(new Event("input", { bubbles: true }))
  })
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(0), 16))
    vi.stubGlobal("cancelAnimationFrame", clearTimeout)
    vi.stubGlobal("ResizeObserver", class { observe = observe; disconnect = disconnect })
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    render()
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("updates locally and retains every edit immediately, coalescing parent updates for 120 ms", () => {
    edit("a")
    act(() => vi.advanceTimersByTime(100))
    edit("abc")
    edit("aXbc", 2)
    expect(input().value).toBe("aXbc")
    expect(input().selectionStart).toBe(2)
    expect(onDraftChange.mock.calls).toEqual([["a"], ["abc"], ["aXbc"]])
    expect(onChange).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(119))
    expect(onChange).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(onChange.mock.calls).toEqual([["aXbc"]])
    render("aXbc")
    expect(input().selectionStart).toBe(2)
    expect(observe).toHaveBeenCalledTimes(1)
    expect(disconnect).not.toHaveBeenCalled()
  })

  it("ignores an older parent echo while a newer mid-string edit is pending", () => {
    edit("ab")
    act(() => vi.advanceTimersByTime(120))
    edit("aXb", 2)
    render("ab")
    expect(input().value).toBe("aXb")
    expect(input().selectionStart).toBe(2)
    act(() => vi.advanceTimersByTime(120))
    expect(onChange).toHaveBeenLastCalledWith("aXb")
  })

  it("submits the exact latest value before the debounce and suppresses composition Enter", () => {
    edit("  rapid input  ")
    for (const init of [{ isComposing: true }, { keyCode: 229 }, { shiftKey: true }]) {
      act(() => input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...init })))
    }
    expect(onSubmit).not.toHaveBeenCalled()
    act(() => input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })))
    expect(onSubmit.mock.calls[0]?.[1]).toBe("  rapid input  ")
    expect(onChange).not.toHaveBeenCalled()
  })

  it("cancels a pending update on explicit reset so it cannot restore sent text", () => {
    edit("send me")
    render("", { value: "" })
    expect(input().value).toBe("")
    act(() => vi.advanceTimersByTime(120))
    expect(onChange).not.toHaveBeenCalled()
    edit("next draft")
    act(() => vi.advanceTimersByTime(120))
    expect(onChange).toHaveBeenCalledExactlyOnceWith("next draft")
  })

  it("flushes on hiding and cancels its timer; an old reset does not clear a remounted draft", () => {
    const reset = { value: "" }
    render("", reset)
    edit("retain before timer")
    act(() => root.render(null))
    expect(onChange).toHaveBeenCalledExactlyOnceWith("retain before timer")
    act(() => vi.advanceTimersByTime(120))
    expect(onChange).toHaveBeenCalledTimes(1)
    render("retain before timer", reset)
    expect(input().value).toBe("retain before timer")
  })
})
