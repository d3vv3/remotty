import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

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
  })
})
