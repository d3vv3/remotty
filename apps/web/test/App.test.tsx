/** @vitest-environment jsdom */

import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  loadCurrentIdentity: vi.fn(),
  pairingBundleFrom: vi.fn(),
  routeForStoredIdentity: vi.fn((pathname: string, enrolled: boolean) => pathname === "/" && enrolled ? "/app" : pathname),
}))

vi.mock("../src/infrastructure/storage", () => ({
  CURRENT_IDENTITY_MARKER: "remotty-current-identity",
  loadCurrentIdentity: mocks.loadCurrentIdentity,
}))
vi.mock("../src/features/pairing", () => ({
  pairingBundleFrom: mocks.pairingBundleFrom,
  routeForStoredIdentity: mocks.routeForStoredIdentity,
}))
vi.mock("../src/features/pwa", () => ({
  PwaUpdatePrompt: () => <div data-testid="pwa-update" />,
}))
vi.mock("../src/pages", () => ({
  LandingPage: () => <div data-testid="landing" />,
  PrivacyPage: () => <div data-testid="privacy" />,
  WorkspacePage: ({ initialBundle }: { initialBundle?: unknown }) => <div data-testid="workspace" data-initial-bundle={initialBundle ? "present" : "absent"} />,
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe("App route composition", () => {
  let container: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    localStorage.clear()
    history.replaceState({}, "", "/")
    mocks.loadCurrentIdentity.mockResolvedValue(undefined)
    mocks.pairingBundleFrom.mockReturnValue(undefined)
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  const renderApp = async () => {
    const { App } = await import("../src/app/App")
    await act(async () => { root.render(<App />) })
  }

  it("mounts the landing page and one global update prompt at the public route", async () => {
    await renderApp()

    expect(container.querySelector("[data-testid=landing]")).toBeTruthy()
    expect(container.querySelectorAll("[data-testid=pwa-update]")).toHaveLength(1)
  })

  it("mounts the privacy page and the global update prompt", async () => {
    history.replaceState({}, "", "/privacy")
    await renderApp()

    expect(container.querySelector("[data-testid=privacy]")).toBeTruthy()
    expect(container.querySelectorAll("[data-testid=pwa-update]")).toHaveLength(1)
  })

  it("forwards a pairing bundle to the workspace and clears it from the URL", async () => {
    const bundle = { inviteId: "invite" }
    history.replaceState({}, "", "/pair#encrypted-bundle")
    mocks.pairingBundleFrom.mockReturnValue(bundle)

    await renderApp()

    expect(mocks.pairingBundleFrom).toHaveBeenCalledWith("http://localhost:3000/pair#encrypted-bundle")
    expect(location.pathname).toBe("/pair")
    expect(container.querySelector("[data-testid=workspace]")?.getAttribute("data-initial-bundle")).toBe("present")
    expect(container.querySelectorAll("[data-testid=pwa-update]")).toHaveLength(1)
  })

  it("uses the workspace for the app route without an initial pairing bundle", async () => {
    history.replaceState({}, "", "/app")
    await renderApp()

    expect(container.querySelector("[data-testid=workspace]")?.getAttribute("data-initial-bundle")).toBe("absent")
  })

  it("preserves the stored-identity redirect before selecting the workspace", async () => {
    localStorage.setItem("remotty-current-identity", "identity")
    mocks.loadCurrentIdentity.mockResolvedValue({ enrolled: true })

    await renderApp()
    await act(async () => { await Promise.resolve() })

    expect(mocks.routeForStoredIdentity).toHaveBeenCalledWith("/", true)
    expect(location.pathname).toBe("/app")
    expect(container.querySelector("[data-testid=workspace]")).toBeTruthy()
    expect(container.querySelectorAll("[data-testid=pwa-update]")).toHaveLength(1)
  })
})
