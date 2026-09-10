/** @vitest-environment jsdom */

import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { QuestionPanel } from "../src/features/questions"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const question = (id: string, label: string) => ({ id, sessionID: "session-1", questions: [{ header: "Choice", question: "Choose", options: [{ label, description: label }], custom: true }] })

describe("QuestionPanel", () => {
  let container: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  beforeEach(() => { container = document.createElement("div"); document.body.append(container); root = createRoot(container) })
  afterEach(async () => { await act(async () => root.unmount()); container.remove() })

  it("resets stale answers when the pending request changes", async () => {
    await act(async () => root.render(<QuestionPanel requestInfo={question("one", "First")} request={vi.fn()} onError={vi.fn()} />))
    const input = container.querySelector<HTMLInputElement>("input")!
    await act(async () => { input.value = "custom"; input.dispatchEvent(new Event("input", { bubbles: true })) })
    expect(input.value).toBe("custom")
    await act(async () => root.render(<QuestionPanel requestInfo={question("two", "Second")} request={vi.fn()} onError={vi.fn()} />))
    expect(container.querySelector<HTMLInputElement>("input")!.value).toBe("")
  })

  it("prevents duplicate replies while a submission is pending", async () => {
    let resolve!: () => void
    const request = vi.fn(() => new Promise<void>((done) => { resolve = done }))
    await act(async () => root.render(<QuestionPanel requestInfo={question("one", "First")} request={request} onError={vi.fn()} />))
    await act(async () => container.querySelectorAll<HTMLButtonElement>(".option-list button")[0]!.click())
    const option = container.querySelector<HTMLButtonElement>(".option-list button")!
    expect(option.getAttribute("aria-pressed")).toBe("true")
    const submit = container.querySelector<HTMLButtonElement>(".confirm")!
    await act(async () => { submit.click(); submit.click() })
    expect(request).toHaveBeenCalledOnce()
    expect(submit.disabled).toBe(true)
    expect(option.disabled).toBe(true)
    await act(async () => resolve())
  })
})
