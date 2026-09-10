/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import { PwaInstallContext, PwaInstallPrompt, PwaUpdateVisibleContext } from "../src/features/pwa/PwaInstallPrompt"
import { usePwaInstall } from "../src/features/pwa/hooks/usePwaInstall"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

it("captures early, gates the invitation, uses a gesture once, and remembers the native decision even without storage", async () => {
  const mode = Object.assign(new EventTarget(), { matches: false })
  vi.stubGlobal("matchMedia", () => mode)
  localStorage.clear()
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  function Harness({ eligible = true, update = false }) {
    const install = usePwaInstall()
    return <PwaInstallContext.Provider value={install}><PwaUpdateVisibleContext.Provider value={update}>
      <PwaInstallPrompt eligible={eligible} />
    </PwaUpdateVisibleContext.Provider></PwaInstallContext.Provider>
  }
  const emit = async (prompt = vi.fn().mockResolvedValue(undefined), userChoice = Promise.resolve({ outcome: "dismissed" })) => {
    const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), { prompt, userChoice })
    await act(async () => { window.dispatchEvent(event) })
    return event
  }
  try {
    await act(async () => root.render(<Harness eligible={false} />))
    expect(container.textContent).toBe("")
    const unsupported = new Event("beforeinstallprompt", { cancelable: true })
    await act(async () => { window.dispatchEvent(unsupported) })
    expect(unsupported.defaultPrevented).toBe(false)
    mode.matches = true
    await emit()
    await act(async () => root.render(<Harness />))
    expect(container.textContent).toBe("")
    mode.matches = false
    await act(async () => root.render(<Harness eligible={false} />))
    let choose!: (choice: { outcome: string }) => void
    const choice = new Promise<{ outcome: string }>((resolve) => { choose = resolve })
    const prompt = vi.fn().mockRejectedValueOnce(new Error("Transient failure")).mockResolvedValue(undefined)
    const event = await emit(prompt, choice)
    expect(event.defaultPrevented).toBe(true)
    expect(container.textContent).toBe("")
    await act(async () => root.render(<Harness update />))
    expect(container.textContent).toBe("")
    await act(async () => root.render(<Harness />))
    expect(container.textContent).toContain("Install Remotty")
    expect(prompt).not.toHaveBeenCalled()
    await act(async () => container.querySelector("button")!.click())
    expect(container.textContent).toContain("Try again")
    await act(async () => {
      container.querySelector("button")!.click()
      container.querySelector("button")!.click()
    })
    expect(prompt).toHaveBeenCalledTimes(2)
    expect(container.querySelector("button")!.disabled).toBe(true)
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage blocked") })
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Storage blocked") })
    await act(async () => { choose({ outcome: "dismissed" }); await choice })
    expect(container.textContent).toBe("")
    await act(async () => root.render(<Harness key="remount" />))
    await emit()
    expect(container.textContent).toBe("")
  } finally {
    await act(async () => root.unmount())
    container.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  }
})
