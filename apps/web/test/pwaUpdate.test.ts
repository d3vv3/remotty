import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"
import { shouldShowPwaUpdate } from "../src/pwaUpdate"

describe("controlled PWA updates", () => {
  it("waits for user confirmation and gives both update paths", async () => {
    const [config, app] = await Promise.all([
      readFile(new URL("../vite.config.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
    ])

    expect(config).toContain('registerType: "prompt"')
    expect(config).not.toContain("skipWaiting: true")
    expect(config).not.toContain("clientsClaim: true")
    expect(app).toContain("Update now")
    expect(app).toContain("close every Remotty tab and installed app window")
    expect(app).toContain("opencode plugin opencode-remotty --global --force")
    expect(app).toContain("const [deferred, setDeferred] = useState(false)")
    expect(app).toContain("<Button disabled={updating} onClick={() => setDeferred(true)}>Later</Button>")
    expect(app).toContain('className="pwa-update-affordance"')
    expect(app).toContain("onClick={() => setDeferred(false)}")
    expect(app).not.toContain("setNeedRefresh(false)")
    expect(app).toContain("const dialogRef = useRef<HTMLElement>(null)")
    expect(app).toContain("const updateActionRef = useRef<HTMLButtonElement>(null)")
    expect(app).toContain("const affordanceRef = useRef<HTMLButtonElement>(null)")
    expect(app).toContain("document.querySelectorAll<HTMLElement>('[role=\"dialog\"]')")
    expect(app).toContain('underlyingDialog?.querySelector<HTMLElement>("button:not([disabled])") ?? underlyingDialog ?? affordanceRef.current')
    expect(app).toContain("const focusTarget = updateActionRef.current ?? dialogRef.current")
    expect(app).toContain("focusTarget?.focus()")
    expect(app).toContain("ref={updateActionRef}")
    expect(app).toContain("ref={affordanceRef}")
    expect(app).toContain('variant="primary" loading={updating}')
  })

  it("applies update visibility to the current route and pairing state", () => {
    expect(shouldShowPwaUpdate(false, "/app", true)).toBe(false)
    expect(shouldShowPwaUpdate(true, "/pair", true)).toBe(false)
    expect(shouldShowPwaUpdate(true, "/", false)).toBe(false)
    expect(shouldShowPwaUpdate(true, "/app", false)).toBe(true)
    expect(shouldShowPwaUpdate(true, "/privacy", true)).toBe(true)
  })

  it("restores focus to an active underlying dialog before the compact affordance", async () => {
    const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8")
    expect(app).toContain("if (deferred)")
    expect(app).toContain("document.querySelectorAll<HTMLElement>('[role=\"dialog\"]')")
    expect(app).toContain("dialog.getClientRects().length > 0")
    expect(app).toContain('underlyingDialog?.querySelector<HTMLElement>("button:not([disabled])") ?? underlyingDialog ?? affordanceRef.current')
  })

  it("isolates Escape and Tab in the full update dialog before underlying modal handlers", async () => {
    const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8")
    expect(app).toContain("if (!visible || deferred) return")
    expect(app).toContain('if (event.key === "Escape")')
    expect(app).toContain("setDeferred(true)")
    expect(app).toContain('if (event.key !== "Tab") return')
    expect(app).toContain("event.stopImmediatePropagation()")
    expect(app).toContain("if (event.shiftKey && (active === first || !dialogRef.current?.contains(active)))")
    expect(app).toContain("else if (!event.shiftKey && (active === last || !dialogRef.current?.contains(active)))")
    expect(app).toContain('window.addEventListener("keydown", handleKeyDown, true)')
    expect(app).toContain('window.removeEventListener("keydown", handleKeyDown, true)')
  })

  it("shows the active PWA build in connection details", async () => {
    const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8")
    expect(app).toContain("pwaBuildFromModuleScriptUrls")
    expect(app).toContain("PWA build")
  })

  it("keeps the compact update affordance inside the topbar without toast overlap", async () => {
    const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8")
    expect(css).toContain("top: calc(14px + env(safe-area-inset-top)); left: 50%; right: auto;")
    expect(css).toContain("transform: translateX(-50%)")
    expect(css).toContain("transform: translate(-50%, 1px)")
    expect(css).toContain("top: calc(10px + env(safe-area-inset-top)); width: 36px; height: 36px;")
    expect(css).toContain(".pwa-update-affordance span { display: none; }")
    expect(css).toContain("@media (max-width: 640px)")
    expect(css).toContain("top: auto; bottom: calc(126px + env(safe-area-inset-bottom)); left: 12px; right: auto; transform: none;")
    expect(css).toContain(".pwa-update-affordance:hover { transform: translate(1px, 1px); }")
  })
})
