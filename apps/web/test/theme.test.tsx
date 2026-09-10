/** @vitest-environment jsdom */

import { act } from "react"
import { readFileSync } from "node:fs"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ThemeControl } from "../src/components/ui/ThemeControl"

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8")
const themeInit = source("../public/theme-init.js")

const tokenValue = (css: string, theme: "dark" | "light", name: string) => {
  const selector = theme === "dark" ? ':root[data-theme="dark"]' : ':root[data-theme="light"]'
  const start = css.indexOf(selector)
  const block = css.slice(start, css.indexOf("}", start))
  return block.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1]
}

const luminance = (hex: string) => {
  const channels = hex.slice(1).match(/../g)!.map((channel) => parseInt(channel, 16) / 255)
    .map((channel) => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4)
  return .2126 * channels[0]! + .7152 * channels[1]! + .0722 * channels[2]!
}

const contrast = (first: string, second: string) => {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a)
  return (values[0]! + .05) / (values[1]! + .05)
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const runThemeInit = () => Function(themeInit)()

describe("theme foundation", () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute("data-theme")
    document.documentElement.removeAttribute("style")
    document.head.innerHTML = '<meta name="theme-color" content="">'
    delete window.remottyTheme
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
  })

  afterEach(() => vi.unstubAllGlobals())

  it("starts dark, restores storage safely, and publishes changes", () => {
    runThemeInit()
    expect(document.documentElement.dataset.theme).toBe("dark")
    expect(document.documentElement.style.colorScheme).toBe("dark")

    const listener = vi.fn()
    window.addEventListener("remotty-theme-change", listener)
    expect(window.remottyTheme?.set("light")).toBe("light")
    expect(localStorage.getItem("remotty-theme")).toBe("light")
    expect(document.documentElement.dataset.theme).toBe("light")
    expect(listener).toHaveBeenCalledOnce()

    document.documentElement.removeAttribute("data-theme")
    runThemeInit()
    expect(window.remottyTheme?.get()).toBe("light")
  })

  it("defines both palettes, semantic Tailwind colors, aliases, and blocking head order", () => {
    const tokens = source("../public/design-tokens.css")
    const styles = source("../src/styles.css")
    const html = source("../index.html")
    const initPosition = html.indexOf('<script src="/theme-init.js"></script>')
    const tokenPosition = html.indexOf('<link rel="stylesheet" href="/src/design-tokens.css"')

    expect(tokens).toContain(':root[data-theme="dark"]')
    expect(tokens).toContain(':root[data-theme="light"]')
    for (const token of ["background", "surface", "surface-raised", "text", "text-muted", "border", "accent", "on-accent", "focus", "success", "warning", "danger", "info", "overlay"]) {
      expect(tokens).toContain(`--${token}:`)
      if (["background", "surface", "surface-raised", "text", "text-muted", "border", "accent", "on-accent", "success", "warning", "danger", "info"].includes(token)) {
        expect(styles).toContain(`--color-${token}: var(--${token})`)
      }
    }
    for (const alias of ["ink", "muted", "dim", "line", "line-bright", "void", "panel", "raised", "acid", "coral", "cyan", "amber", "red", "green"]) {
      expect(tokens).toContain(`--${alias}: var(--`)
    }
    expect(initPosition).toBeGreaterThan(0)
    expect(tokenPosition).toBeGreaterThan(initPosition)
    expect(initPosition).toBeLessThan(html.indexOf('<script type="module"'))
  })

  it("shares fonts and non-color primitives with static pages", () => {
    const tokens = source("../public/design-tokens.css")
    const styles = source("../src/styles.css")

    expect(source("../src/design-tokens.css")).toContain('@import "../public/design-tokens.css"')
    expect(source("../public/install/index.html")).toContain('href="/design-tokens.css"')

    expect(tokens.match(/@font-face/g)).toHaveLength(6)
    expect(styles).not.toContain("@font-face")
    for (const token of ["font-ui", "font-display", "font-code", "space-1", "space-4", "radius-md", "radius-lg", "elevation-raised", "motion-fast", "ease-standard"]) {
      expect(tokens).toContain(`--${token}:`)
      expect(styles).toContain(`var(--${token})`)
    }
  })

  it("keeps semantic foreground pairs above normal-text contrast", () => {
    const tokens = source("../public/design-tokens.css")
    const pairs = [
      ["accent", "on-accent"],
      ["success", "on-success"],
      ["warning", "on-warning"],
      ["danger", "on-danger"],
      ["info", "on-info"],
      ["message-own-surface", "message-own-text"],
      ["message-own-surface", "message-own-muted"],
    ] as const

    for (const theme of ["dark", "light"] as const) {
      for (const [background, foreground] of pairs) {
        expect(contrast(tokenValue(tokens, theme, background)!, tokenValue(tokens, theme, foreground)!)).toBeGreaterThanOrEqual(4.5)
      }
    }
    expect(contrast(tokenValue(tokens, "light", "accent")!, tokenValue(tokens, "light", "accent-surface")!)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(tokenValue(tokens, "light", "info")!, tokenValue(tokens, "light", "info-surface")!)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(tokenValue(tokens, "light", "warning")!, tokenValue(tokens, "light", "warning-surface")!)).toBeGreaterThanOrEqual(4.5)
  })

  it("keeps own messages readable when an older token sheet lacks message tokens", () => {
    const styles = source("../src/styles.css")
    const rule = (selector: string) => [...styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter((match) => match[1]!.trim() === selector).at(-1)?.[2]

    expect(rule(".message.user")).toContain("background: var(--message-own-surface, var(--brand))")
    for (const selector of [".message.user", ".message.user .entry-byline strong", ".message.user p"]) {
      expect(rule(selector)).toContain("color: var(--message-own-text, var(--on-brand))")
    }
    expect(rule(".message.user .message-time")).toContain("color: var(--message-own-muted, var(--on-brand))")
  })

  it("bounds intrinsic content through mobile workspace and overlay tracks", () => {
    const styles = source("../src/styles.css")

    expect(styles).toMatch(/\.app-shell \{[^}]*height: var\(--viewport-height, 100dvh\)[^}]*overflow: hidden/)
    expect(styles).toMatch(/\.workspace-layout \{[^}]*min-width: 0; max-width: 100%[^}]*overflow: hidden/)
    expect(styles).toMatch(/\.detail-content \{[^}]*width: 100%; min-width: 0; max-width: 100%/)
    expect(styles).toMatch(/\.change-patch pre \{[^}]*width: 100%; min-width: 0; max-width: 100%/)
    expect(styles).toMatch(/\.composer textarea \{[^}]*width: 100%; min-width: 0; max-width: 100%/)
    expect(styles).toMatch(/\.connection-overlay \{[^}]*grid-template-columns: minmax\(0, 1fr\)/)
    expect(styles).toMatch(/\.connection-dialog \{[^}]*width: 100%; min-width: 0; max-width: 460px/)
    expect(styles).toMatch(/\.new-session-body select \{[^}]*width: 100%; min-width: 0; max-width: 100%/)
  })

  it("keeps combined requests scrollable above a pinned composer", () => {
    const styles = source("../src/styles.css")
    const detail = source("../src/features/session/components/SessionDetail.tsx")

    expect(detail).toContain('className="request-stack"')
    expect(detail.indexOf('className="request-stack"')).toBeLessThan(detail.indexOf("showComposer && <Composer"))
    expect(styles).toMatch(/\.session-dock \{[^}]*position: absolute;[^}]*display: flex; flex-direction: column;/)
    expect(styles).toContain("max-height: calc(100% - max(var(--session-header-height, 0px), var(--subagent-selector-height, 0px)) - 24px)")
    expect(detail.indexOf('className="request-stack"')).toBeLessThan(detail.indexOf('className="command-bar"'))
    expect(styles).toMatch(/\.request-stack \{[^}]*min-height: 0[^}]*overflow-y: auto[^}]*overscroll-behavior: contain/)
    expect(styles).toContain(".request-stack > .permission-panel, .request-stack > .question-panel:not(.collapsed) { max-height: none; overflow: visible; }")
    expect(styles).toMatch(/\.composer \{[^}]*flex: 0 0 auto/)
    expect(styles).toMatch(/\.command-bar \{[^}]*flex: 0 0 auto/)
    expect(detail).toContain('aria-label="Session commands"')
  })
})

describe("ThemeControl", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    document.documentElement.dataset.theme = "dark"
    window.remottyTheme = {
      get: () => document.documentElement.dataset.theme === "light" ? "light" : "dark",
      set: (theme) => {
        document.documentElement.dataset.theme = theme
        window.dispatchEvent(new CustomEvent("remotty-theme-change", { detail: { theme } }))
        return theme
      },
      refresh: vi.fn(),
    }
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    delete window.remottyTheme
  })

  it("exposes the destination theme and toggles from an icon button", async () => {
    await act(async () => root.render(<ThemeControl />))
    const button = container.querySelector("button")
    expect(button?.getAttribute("aria-label")).toBe("Use light theme")
    expect(button?.getAttribute("aria-pressed")).toBe("false")

    await act(async () => button?.click())
    expect(document.documentElement.dataset.theme).toBe("light")
    expect(button?.getAttribute("aria-label")).toBe("Use dark theme")
    expect(button?.getAttribute("aria-pressed")).toBe("true")
  })
})
