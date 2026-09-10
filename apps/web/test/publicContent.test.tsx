// @vitest-environment jsdom
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { LandingPage } from "../src/pages/LandingPage"
import { PrivacyPage } from "../src/pages/PrivacyPage"
import { PairingScreen } from "../src/features/pairing/PairingScreen"

const documentFor = (markup: string) => new DOMParser().parseFromString(markup, "text/html")
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

describe("public content and entry points", () => {
  it("shows the authentic responsive product image after the primary actions", async () => {
    const page = documentFor(renderToStaticMarkup(<LandingPage />))
    expect(page.querySelector("h1")?.textContent).toBe("Your agents.Within reach.")
    const hero = page.querySelector(".landing-masthead")!
    expect([...hero.querySelectorAll(".public-action")].map(a => a.getAttribute("href"))).toEqual(["#get-started", "/pair"])
    expect(page.querySelector("#get-started")?.textContent).toContain("Install the plugin")
    const image = hero.querySelector("img")!
    expect(image.alt).toMatch(/real Remotty session.*amber user message.*composer.*Subagents/)
    expect(image.width).toBe(720)
    expect(image.height).toBe(1476)
    expect(image.getAttribute("sizes")).toContain("280px")
    expect(image.getAttribute("srcset")).toBe("/remotty-session-360.webp 360w, /remotty-session-720.webp 720w")
    expect(hero.querySelector(".public-actions")!.compareDocumentPosition(image) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    for (const size of [360, 720]) {
      const asset = await readFile(resolve(`public/remotty-session-${size}.webp`))
      expect(asset.toString("ascii", 8, 12)).toBe("WEBP")
      expect(asset.byteLength).toBeLessThan(100_000)
      expect(asset.includes(Buffer.from("EXIF"))).toBe(false)
    }
    expect(page.querySelector('a[href="#features"]')).not.toBeNull()
    expect(page.querySelector("#features")?.textContent).toContain("See what changed")
  })

  it("retains navigable install, pair, privacy and source links on each public surface", async () => {
    const pages = [
      renderToStaticMarkup(<LandingPage />),
      renderToStaticMarkup(<PrivacyPage />),
      renderToStaticMarkup(<PairingScreen onConnect={() => {}} />),
      await readFile(resolve("public/install/index.html"), "utf8"),
    ]
    for (const markup of pages) {
      const page = documentFor(markup)
      expect(page.querySelector('nav[aria-label="Primary navigation"]')).not.toBeNull()
      expect(page.querySelector('nav[aria-label="Footer navigation"]')).not.toBeNull()
      for (const href of ["/", "/install/", "/pair", "/privacy", "https://github.com/d3vv3/remotty"]) {
        expect(page.querySelector(`a[href="${href}"]`)).not.toBeNull()
      }
      expect(page.querySelectorAll("h1")).toHaveLength(1)
      expect(page.body.textContent).not.toContain("Full installation guide")
    }
  })

  it("preserves privacy disclosures and readable, focusable install commands", async () => {
    const privacy = documentFor(renderToStaticMarkup(<PrivacyPage />))
    expect([...privacy.querySelectorAll("dt")].map(el => el.textContent)).toEqual(["Session content", "Device secrets", "Push notifications", "Visible metadata", "Tracking"])
    for (const disclosure of ["IP addresses", "IndexedDB", "AES-256-GCM", "compromised browser", "delay, drop, or reorder", "outbound WSS"]) expect(privacy.body.textContent).toContain(disclosure)
    const install = documentFor(await readFile(resolve("public/install/index.html"), "utf8"))
    for (const command of install.querySelectorAll("pre")) {
      expect(command.tabIndex).toBe(0)
      expect(command.getAttribute("aria-label")).toBeTruthy()
    }
    for (const action of ["pair", "invite", "devices", "revoke <device-id>", "remove <device-id>", "remove --revoked", "status"]) expect(install.querySelector('[aria-label="remotty command reference"]')?.textContent).toContain(`remotty ${action}`)
    expect(install.querySelector("#hosted-title")).not.toBeNull()
  })

  it("keeps invalid pasted invites on the pairing form with an associated error", async () => {
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)
    const onConnect = vi.fn()
    try {
      await act(async () => root.render(<PairingScreen onConnect={onConnect} />))
      await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })))
      expect(onConnect).not.toHaveBeenCalled()
      const input = container.querySelector("input")!
      expect(input.getAttribute("aria-invalid")).toBe("true")
      expect(document.getElementById(input.getAttribute("aria-describedby")!)?.textContent).toContain("Enter a valid remotty v2 encrypted invite.")
      expect(container.querySelector('button[aria-label="Scan pairing QR code"]')).not.toBeNull()
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })
})
