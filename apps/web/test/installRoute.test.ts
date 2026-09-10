import { createServer } from "vite"
import { describe, expect, it } from "vitest"

describe("static installation guide in development", () => {
  it("serves the guide for directory URLs instead of the pairing app fallback", async () => {
    const server = await createServer({ server: { host: "127.0.0.1", port: 0, open: false }, logLevel: "silent" })
    try {
      await server.listen()
      const address = server.httpServer!.address() as { port: number }
      for (const path of ["/install", "/install/", "/install/?from=footer", "/install/index.html"]) {
        const response = await fetch(`http://127.0.0.1:${address.port}${path}`)
        expect(response.status).toBe(200)
        const html = await response.text()
        expect(html).toContain('aria-label="remotty command reference"')
        expect(html).not.toContain('/src/main.tsx')
      }
    } finally {
      await server.close()
    }
  })
})
