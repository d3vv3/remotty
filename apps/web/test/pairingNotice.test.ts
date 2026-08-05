import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

const relaySource = () => readFile(new URL("../src/useRelay.ts", import.meta.url), "utf8")

describe("pairing without a connected workspace", () => {
  it("tells the user how to start the workspace relay", async () => {
    const source = await relaySource()
    expect(source).toContain("No OpenCode workspace is connected.")
    expect(source).toContain("opencode plugin opencode-remotty --global --force")
    expect(source).toContain("Pairing resumes automatically.")
  })

  it("clears the notice when a relay connects or enrollment succeeds", async () => {
    const source = await relaySource()
    const relayConnected = source.indexOf("setError(undefined)\n              void enroll()")
    expect(relayConnected).toBeGreaterThan(-1)
    const accepted = source.indexOf("setEnrolled(true)\n        setError(undefined)")
    expect(accepted).toBeGreaterThan(-1)
  })
})
