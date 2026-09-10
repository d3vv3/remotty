/** @vitest-environment jsdom */
import * as React from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let useInstall: typeof import("../src/features/pwa/hooks/usePwaInstall").usePwaInstall
let state: ReturnType<typeof useInstall>
let mode: EventTarget & { matches: boolean }
let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
function Harness() { state = useInstall(); return null }

beforeEach(async () => {
  vi.resetModules()
  vi.doMock("react", () => React)
  useInstall = (await import("../src/features/pwa/hooks/usePwaInstall")).usePwaInstall
  localStorage.clear()
  mode = Object.assign(new EventTarget(), { matches: false })
  vi.stubGlobal("matchMedia", () => mode)
  container = document.createElement("div")
  root = createRoot(container)
  await React.act(async () => root.render(<Harness />))
})
afterEach(async () => {
  await React.act(async () => root.unmount())
  vi.unstubAllGlobals()
  vi.doUnmock("react")
})
const offer = async (outcome = "accepted") => {
  const prompt = vi.fn().mockResolvedValue(undefined)
  await React.act(async () => { window.dispatchEvent(Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
    prompt, userChoice: Promise.resolve({ outcome }),
  })) })
  return prompt
}

it.each(["accepted", "dismissed"])("persists the native %s choice and suppresses later offers", async (outcome) => {
  const prompt = await offer(outcome)
  expect(state.available).toBe(true)
  await React.act(async () => { await state.install() })
  expect(prompt).toHaveBeenCalledOnce()
  expect(localStorage.getItem("remotty-install-prompt-seen")).toBe("true")
  await offer()
  expect(state.available).toBe(false)
})

it.each(["dismiss", "appinstalled", "standalone"])("closes and remembers %s", async (action) => {
  await offer()
  expect(state.available).toBe(true)
  await React.act(async () => {
    if (action === "dismiss") state.dismiss()
    else if (action === "appinstalled") window.dispatchEvent(new Event("appinstalled"))
    else { mode.matches = true; mode.dispatchEvent(new Event("change")) }
  })
  expect(state.available).toBe(false)
  expect(localStorage.getItem("remotty-install-prompt-seen")).toBe("true")
  await offer()
  expect(state.available).toBe(false)
})

it("honors a decision persisted by a previous page load", async () => {
  localStorage.setItem("remotty-install-prompt-seen", "true")
  await offer()
  expect(state.available).toBe(false)
})
