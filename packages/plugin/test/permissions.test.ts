import { describe, expect, it, vi } from "vitest"
import { normalizePermissionRequest, normalizePermissionRequests, permissionNotification, permissionReplyId, permissionReplyRequest } from "../src/permissions"
import { routeSessionRequests } from "../src/sessions"

describe("OpenCode permission compatibility", () => {
  it("normalizes standard, legacy, and v2 asked payloads", () => {
    expect(normalizePermissionRequest({ id: "standard", sessionID: "root", permission: "bash", patterns: ["git status"], metadata: {} }))
      .toMatchObject({ permission: "bash", patterns: ["git status"], replyDialect: "standard" })
    expect(normalizePermissionRequest({ id: "legacy", sessionID: "root", type: "edit", pattern: "README.md", metadata: {} }))
      .toMatchObject({ permission: "edit", patterns: ["README.md"], replyDialect: "standard" })
    expect(normalizePermissionRequest({ id: "legacy-array", sessionID: "root", type: "edit", pattern: ["README.md", "docs/**"], metadata: {} }))
      .toMatchObject({ permission: "edit", patterns: ["README.md", "docs/**"], replyDialect: "standard" })
    expect(normalizePermissionRequest({ id: "v2", sessionID: "child", action: "filesystem.write", resources: ["src/app.ts"], save: ["src/app.ts"], metadata: {} }))
      .toMatchObject({ permission: "filesystem.write", patterns: ["src/app.ts"], always: ["src/app.ts"], replyDialect: "v2" })
  })

  it("accepts direct and wrapped snapshot lists, deduping without logging their content", () => {
    const warning = vi.fn()
    expect(normalizePermissionRequests([
      { id: "same", sessionID: "root", permission: "bash", patterns: [] },
      { id: "same", sessionID: "root", action: "bash", resources: [] },
      { id: "invalid", sessionID: "root" },
    ], warning)).toMatchObject([{ id: "same", replyDialect: "v2" }])
    expect(normalizePermissionRequests({ location: "local", data: [
      { id: "wrapped", sessionID: "root", action: "bash", resources: [], save: [] },
    ] }, warning)).toMatchObject([{ id: "wrapped", replyDialect: "v2", always: [] }])
    expect(warning).toHaveBeenCalledTimes(1)
  })

  it("routes a child request to its displayed root while retaining the reply target", () => {
    const request = normalizePermissionRequest({ id: "v2", sessionID: "child", action: "bash", resources: [] })!
    expect(routeSessionRequests([request], [{ id: "root" }, { id: "child", parentID: "root" }])).toMatchObject([{
      sessionID: "root", targetSessionID: "child", replyDialect: "v2",
    }])
  })

  it("uses the correct reply contract and preserves v2 routing in push data", () => {
    expect(permissionReplyRequest({ sessionId: "session", permissionId: "permission", response: "once" }))
      .toEqual({ path: { id: "session", permissionID: "permission" }, body: { response: "once" } })
    expect(permissionReplyRequest({ sessionId: "session/id", permissionId: "permission/id", response: "always", replyDialect: "v2" }))
      .toEqual({ url: "/api/session/session%2Fid/permission/permission%2Fid/reply", body: { reply: "always" } })
    const request = routeSessionRequests([normalizePermissionRequest({ id: "permission", sessionID: "child", action: "bash", resources: [] })!], [{ id: "root" }, { id: "child", parentID: "root" }])[0]!
    expect(permissionNotification("relay", "workspace", request).data).toMatchObject({
      sessionId: "root", targetSessionId: "child", replyDialect: "v2",
    })
    expect(permissionReplyId({ id: "v2" })).toBe("v2")
    expect(permissionReplyId({ requestID: "standard" })).toBe("standard")
  })
})
