import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

const canonicalPair = "npx --yes --package opencode-remotty@latest remotty pair"
const canonicalStatus = "npx --yes --package opencode-remotty@latest remotty status"
const canonicalRevoke = "npx --yes --package opencode-remotty@latest remotty revoke"

describe("public discovery artifacts", () => {
  it("publishes install and agent guidance with explicit CLI commands and restart steps", async () => {
    const [install, llms, full, readme, pluginReadme] = await Promise.all([
      readFile(new URL("../public/install/index.html", import.meta.url), "utf8"),
      readFile(new URL("../public/llms.txt", import.meta.url), "utf8"),
      readFile(new URL("../public/llms-full.txt", import.meta.url), "utf8"),
      readFile(new URL("../../../README.md", import.meta.url), "utf8"),
      readFile(new URL("../../../packages/plugin/README.md", import.meta.url), "utf8"),
    ])

    for (const source of [install, llms, full, readme, pluginReadme]) expect(source).toContain(canonicalPair)
    for (const command of [canonicalStatus, canonicalRevoke]) {
      expect(full).toContain(command)
      expect(readme).toContain(command)
      expect(pluginReadme).toContain(command)
    }
    for (const source of [install, llms, full, readme, pluginReadme]) expect(source).toContain("opencode --continue")
    expect(install).toContain("Do not share")
    expect(llms).toContain("must not publish")
    expect(full).toContain("Agents must not publish")
  })

  it("publishes crawl controls for public pages only", async () => {
    const [robots, sitemap] = await Promise.all([
      readFile(new URL("../public/robots.txt", import.meta.url), "utf8"),
      readFile(new URL("../public/sitemap.xml", import.meta.url), "utf8"),
    ])

    expect(robots).toContain("Disallow: /app")
    expect(robots).toContain("Disallow: /pair")
    for (const route of ["https://remotty.devve.space/", "https://remotty.devve.space/install/", "https://remotty.devve.space/privacy"]) expect(sitemap).toContain(route)
  })

  it("falls back only for known SPA routes and keeps static install files distinct", async () => {
    const nginx = await readFile(new URL("../../../deploy/nginx.conf", import.meta.url), "utf8")

    for (const route of ["location = / {", "location = /privacy {", "location = /pair {", "location = /app {"]) expect(nginx).toContain(route)
    expect(nginx).toContain("location /install/ {")
    expect(nginx).toContain("location = /install {")
    expect(nginx).toContain("absolute_redirect off;")
    expect(nginx).toContain("return 301 /install/;")
    expect(nginx).toContain("try_files $uri =404;")
    expect(nginx).not.toContain("$uri/ /index.html")
    const finalGenericLocation = nginx.slice(nginx.lastIndexOf("location / {"))
    expect(finalGenericLocation).toContain("try_files $uri =404;")
    expect(finalGenericLocation).not.toContain("/index.html")
  })

  it("limits the Workbox navigation fallback to known SPA paths", async () => {
    const viteConfig = await readFile(new URL("../vite.config.ts", import.meta.url), "utf8")
    const navigationAllowlist = /^\/(?:privacy|pair|app)?$/

    expect(viteConfig).toContain("navigateFallbackAllowlist: [/^\\/(?:privacy|pair|app)?$/]")
    for (const route of ["/", "/privacy", "/pair", "/app"]) expect(navigationAllowlist.test(route)).toBe(true)
    for (const route of ["/install", "/install/", "/llms.txt", "/robots.txt", "/assets/app.js", "/unknown"]) expect(navigationAllowlist.test(route)).toBe(false)
    expect(viteConfig).not.toContain("navigateFallbackAllowlist: [/^\\/.*$/]")
  })

  it("serves install styling from a CSP-compatible external stylesheet", async () => {
    const [install, css, nginx] = await Promise.all([
      readFile(new URL("../public/install/index.html", import.meta.url), "utf8"),
      readFile(new URL("../public/install/install.css", import.meta.url), "utf8"),
      readFile(new URL("../../../deploy/nginx.conf", import.meta.url), "utf8"),
    ])

    expect(install).toContain('href="/install/install.css"')
    expect(install).not.toContain("<style")
    expect(install).not.toContain("<script")
    expect(css).toContain(":root")
    expect(nginx).toContain("style-src 'self'")
    expect(nginx).toContain("script-src 'self'")
  })

  it("removes dead web broker build plumbing and links the app to installation guidance", async () => {
    const [env, compose, dockerfile, landing, pairing] = await Promise.all([
      readFile(new URL("../../../.env.example", import.meta.url), "utf8"),
      readFile(new URL("../../../compose.yaml", import.meta.url), "utf8"),
      readFile(new URL("../../../Dockerfile", import.meta.url), "utf8"),
        readFile(new URL("../src/pages/LandingPage.tsx", import.meta.url), "utf8"),
        readFile(new URL("../src/features/pairing/PairingScreen.tsx", import.meta.url), "utf8"),
    ])

    for (const source of [env, compose, dockerfile]) expect(source).not.toContain("VITE_REMOTTY_URL")
    expect(landing).toContain('href="/install/"')
    expect(pairing).toContain(canonicalPair)
  })
})
