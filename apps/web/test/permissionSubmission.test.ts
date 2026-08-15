import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"
import { createPermissionSubmissionGuard, isPermissionRequestNotFoundError } from "../src/permissionSubmission"

describe("permission submission state", () => {
  it("prevents duplicate submits synchronously and resets for a replacement permission", () => {
    const guard = createPermissionSubmissionGuard()
    const first = guard.activate("permission-a").token!
    expect(guard.begin("permission-a", "once", first)).toBe(true)
    expect(guard.begin("permission-a", "always", first)).toBe(false)
    expect(guard.state()).toEqual({ permissionId: "permission-a", pending: "once", token: first })
    const second = guard.activate("permission-b").token!
    expect(second).not.toBe(first)
    expect(guard.begin("permission-b", "reject", second)).toBe(true)
    guard.unlock("permission-a", first)
    expect(guard.state()).toEqual({ permissionId: "permission-b", pending: "reject", token: second })
  })

  it("invalidates unmounted requests and rejects stale request tokens", () => {
    const guard = createPermissionSubmissionGuard()
    const token = guard.activate("permission-a").token!
    expect(guard.isActive("permission-a", token)).toBe(true)
    guard.invalidate(token)
    expect(guard.isActive("permission-a", token)).toBe(false)
    expect(guard.begin("permission-a", "once", token)).toBe(false)
  })

  it("recognizes stale permission failures through wrapped messages", () => {
    expect(isPermissionRequestNotFoundError(new Error("RPC failed: Permission request not found (already replied)"))).toBe(true)
    expect(isPermissionRequestNotFoundError("permission request not found")).toBe(true)
    expect(isPermissionRequestNotFoundError(new Error("Relay unavailable"))).toBe(false)
  })

  it("renders a single selected spinner, disables all actions, and reconciles stale replies", async () => {
    const [app, css] = await Promise.all([
      readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
      readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
    ])

    expect(app).toContain("const guardRef = useRef(createPermissionSubmissionGuard())")
    expect(app).toContain("const currentState = guard.state()")
    expect(app).toContain("const requestToken = guard.activate(permission.id).token!")
    expect(app).toContain("return () => { guard.invalidate(requestToken) }")
    expect(app).toContain("const requestToken = guard.state().token")
    expect(app).toContain("if (!guard.begin(permissionId, response, requestToken)) return")
    expect(app).toContain("if (!guard.isActive(permissionId, requestToken)) return")
    expect(app.match(/if \(!guard\.isActive\(permissionId, requestToken\)\) return/g)).toHaveLength(4)
    expect(app).toContain("disabled={Boolean(pending)}")
    expect(app).toContain('loading={pending === "reject"}')
    expect(app).toContain('loading={pending === "once"}')
    expect(app).toContain('loading={pending === "always"}')
    expect(app).toContain('variant="permission"')
    expect(app).toContain('await request({ type: "snapshot.request" })')
    expect(app).toContain("Permission status refresh failed.")
    expect(css).toContain(".ui-button--permission:not(:disabled):hover")
  })
})
