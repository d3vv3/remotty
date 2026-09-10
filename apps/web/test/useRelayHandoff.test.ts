import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

describe("relay position guards", () => {
  it("checks workspace acceptance before hello or snapshot state mutation", async () => {
    const source = await readFile(new URL("../src/features/relay/hooks/useRelay.ts", import.meta.url), "utf8")
    const hello = source.slice(source.indexOf('} else if (data.type === "relay.hello")'), source.indexOf('} else if (data.type === "relay.snapshot")'))
    const snapshot = source.slice(source.indexOf('} else if (data.type === "relay.snapshot")'), source.indexOf('} else if (data.type === "relay.event")'))
    const rejected = hello.indexOf("if (!handoff.accepted) return")

    expect(hello.indexOf("acceptsWorkspaceRelayPosition")).toBeGreaterThanOrEqual(0)
    expect(hello).toContain("acceptsWorkspaceRelayPosition(slicesRef.current, connectedRelaysRef.current")
    expect(hello.indexOf("acceptsWorkspaceRelayPosition")).toBeLessThan(hello.indexOf("recordRelayContact()"))
    expect(rejected).toBeGreaterThanOrEqual(0)
    expect(rejected).toBeLessThan(hello.indexOf("slicesRef.current = handoff.slices"))
    expect(snapshot.indexOf("acceptsWorkspaceRelayPosition")).toBeGreaterThanOrEqual(0)
    expect(snapshot).toContain("acceptsWorkspaceRelayPosition(slicesRef.current, connectedRelaysRef.current")
    expect(snapshot.indexOf("acceptsWorkspaceRelayPosition")).toBeLessThan(snapshot.indexOf("recordRelayContact()"))
    expect(snapshot.indexOf("acceptsWorkspaceRelayPosition")).toBeLessThan(snapshot.indexOf("slicesRef.current.set"))
  })
})
