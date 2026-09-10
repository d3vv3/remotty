/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"
import { ActivityMessages } from "../src/features/session/components/ActivityMessages"
import { activityPresentation } from "../src/features/session/model/activityPresentation"

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const container = document.createElement("div")
let root = createRoot(container)
afterEach(async () => { await act(async () => root.unmount()); root = createRoot(container); vi.restoreAllMocks(); localStorage.clear() })

it.each(["content", "all"] as const)("filters only tools in %s activity and preserves pending without empty bylines", async (visibility) => {
  const messages = [
    { info: { id: "mixed", role: "assistant" }, parts: [{ type: "text", text: "Keep this answer" }, { type: "tool", tool: "read" }] },
    { info: { id: "tool", role: "assistant" }, parts: [{ type: "tool", tool: "bash" }] },
  ]
  const original = structuredClone(messages)
  const render = (showToolCalls: boolean, status = "idle") => act(async () => root.render(<ActivityMessages presentation={activityPresentation(messages, status, false, false, visibility)} showToolCalls={showToolCalls} />))
  await render(true)
  expect(container.querySelectorAll(".tool-details")).toHaveLength(2)
  await render(false)
  expect(container.querySelectorAll(".tool-details")).toHaveLength(0)
  expect(container.querySelectorAll("article")).toHaveLength(1)
  expect(container.textContent).toContain("Keep this answer")
  await render(false, "busy")
  expect(container.querySelectorAll('[aria-label="OpenCode is working"]')).toHaveLength(1)
  expect(container.querySelectorAll("article")).toHaveLength(2)
  await render(true)
  expect(container.querySelectorAll(".tool-details")).toHaveLength(2)
  expect(messages).toEqual(original)
})

it.each(["available", "read blocked", "write blocked"])("shares and retains the preference when storage is %s", async (storage) => {
  vi.resetModules()
  localStorage.setItem("remotty.show-tool-calls", "true")
  if (storage === "read blocked") vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked") })
  if (storage === "write blocked") vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota") })
  const { useShowToolCalls } = await import("../src/features/session/hooks/useShowToolCalls")
  function Control() {
    const [show, setShow] = useShowToolCalls()
    return <button aria-pressed={show} onClick={() => setShow(!show)}>Show tool calls</button>
  }
  await act(async () => root.render(<><Control /><Control /></>))
  expect(container.querySelector("button")?.getAttribute("aria-pressed")).toBe("true")
  await act(async () => container.querySelector("button")!.click())
  expect([...container.querySelectorAll("button")].map((button) => button.getAttribute("aria-pressed"))).toEqual(["false", "false"])
  await act(async () => root.render(null))
  await act(async () => root.render(<Control />))
  expect(container.querySelector("button")?.getAttribute("aria-pressed")).toBe("false")
  if (storage === "available") {
    expect(localStorage.getItem("remotty.show-tool-calls")).toBe("false")
    await act(async () => {
      localStorage.setItem("remotty.show-tool-calls", "true")
      window.dispatchEvent(new StorageEvent("storage", { key: "remotty.show-tool-calls", newValue: "true" }))
    })
    expect(container.querySelector("button")?.getAttribute("aria-pressed")).toBe("true")
  }
})
