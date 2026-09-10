import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

describe("public page redesign", () => {
  it("shares public header and footer components across routed pages", async () => {
    const [landing, privacy, pairing] = await Promise.all([
      readFile(new URL("../src/pages/LandingPage.tsx", import.meta.url), "utf8"),
      readFile(new URL("../src/pages/PrivacyPage.tsx", import.meta.url), "utf8"),
      readFile(new URL("../src/features/pairing/PairingScreen.tsx", import.meta.url), "utf8"),
    ])
    for (const source of [landing, privacy, pairing]) {
      expect(source).toContain("<PublicHeader")
      expect(source).toContain("<PublicFooter")
    }
  })

  it("uses semantic theme tokens without literal colors in owned public styles", async () => {
    const [appCss, staticCss] = await Promise.all([
      readFile(new URL("../src/public.css", import.meta.url), "utf8"),
      readFile(new URL("../public/public-pages.css", import.meta.url), "utf8"),
    ])
    for (const css of [appCss, staticCss]) {
      expect(css).toContain("var(--background)")
      expect(css).toContain("var(--surface)")
      expect(css).toContain("var(--text)")
      expect(css).toContain("var(--accent)")
      expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    }
  })

  it("owns scrolling and constrains narrow grid and command content", async () => {
    const [appCss, staticCss, landing, pairing, install] = await Promise.all([
      readFile(new URL("../src/public.css", import.meta.url), "utf8"),
      readFile(new URL("../public/public-pages.css", import.meta.url), "utf8"),
      readFile(new URL("../src/pages/LandingPage.tsx", import.meta.url), "utf8"),
      readFile(new URL("../src/features/pairing/PairingScreen.tsx", import.meta.url), "utf8"),
      readFile(new URL("../public/install/index.html", import.meta.url), "utf8"),
    ])
    expect(appCss).toContain("height: 100dvh")
    expect(appCss).toContain("overflow-y: auto")
    expect(appCss).toContain(".public-page .public-action")
    expect(appCss).toContain(".numbered-workflow > li > div { min-width: 0; }")
    expect(staticCss).toContain("section > *, ol, ul, li { min-width: 0; }")
    for (const source of [landing, pairing]) expect(source).toContain("tabIndex={0}")
    expect(install).toContain('tabindex="0"')
    expect(install).toContain('aria-label="remotty command reference"')
  })

  it("keeps icon-only mobile header links named", async () => {
    const header = await readFile(new URL("../src/components/public/PublicHeader.tsx", import.meta.url), "utf8")
    expect(header).toContain('aria-label="Install remotty"')
    expect(header).toContain('aria-label="Privacy"')
    expect(header).toContain('aria-label="View remotty source on GitHub"')
  })
})
