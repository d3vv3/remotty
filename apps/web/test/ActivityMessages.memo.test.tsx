/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import ReactMarkdown from "react-markdown"
import { ActivityMessages } from "../src/features/session/components/ActivityMessages"
import { activityPresentation } from "../src/features/session/model/activityPresentation"

vi.mock("react-markdown", () => ({ default: vi.fn(({ children }) => <p>{children}</p>) }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true

it("skips unchanged history and Markdown while allowing timestamps and changed content to refresh", () => {
  vi.useFakeTimers()
  vi.setSystemTime(100_000)
  const container = document.createElement("div")
  const root = createRoot(container)
  const messages = [{ info: { id: "msg", role: "assistant", time: { created: 90_000 } }, parts: [{ type: "text", text: "original prose" }] }]
  const presentation = activityPresentation(messages, "idle", false, false, "content")
  try {
    act(() => root.render(<ActivityMessages presentation={presentation} clock={0} />))
    expect(ReactMarkdown).toHaveBeenCalledTimes(1)
    expect(container.querySelector("time")!.textContent).toBe("now")
    act(() => root.render(<ActivityMessages presentation={presentation} clock={0} />))
    expect(ReactMarkdown).toHaveBeenCalledTimes(1)
    vi.setSystemTime(160_000)
    act(() => root.render(<ActivityMessages presentation={presentation} clock={1} />))
    expect(container.querySelector("time")!.textContent).toBe("1m")
    expect(ReactMarkdown).toHaveBeenCalledTimes(1)
    const changed = activityPresentation([{ ...messages[0]!, parts: [{ type: "text", text: "updated prose" }] }], "idle", false, false, "content")
    act(() => root.render(<ActivityMessages presentation={changed} clock={1} />))
    expect(container.textContent).toContain("updated prose")
    expect(ReactMarkdown).toHaveBeenCalledTimes(2)
  } finally {
    act(() => root.unmount())
    vi.useRealTimers()
  }
})
