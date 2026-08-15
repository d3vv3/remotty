/** @vitest-environment jsdom */

import { StrictMode } from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { PermissionPanel } from "../src/features/permissions"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe("PermissionPanel in StrictMode", () => {
  let container: HTMLDivElement | undefined
  let root: ReturnType<typeof createRoot> | undefined

  afterEach(async () => {
    if (root) await act(async () => root?.unmount())
    container?.remove()
    root = undefined
    container = undefined
  })

  it("submits one permission reply after effect setup, cleanup, and setup", async () => {
    const request = vi.fn(async () => undefined)
    const onError = vi.fn()
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(
        <StrictMode>
          <PermissionPanel
            permission={{ id: "permission-1", sessionID: "session-1", permission: "Bash", patterns: [], metadata: {}, always: [] }}
            request={request}
            onError={onError}
          />
        </StrictMode>,
      )
    })

    const once = [...container.querySelectorAll("button")].find((button) => button.textContent === "Once")
    expect(once).toBeDefined()
    await act(async () => once?.click())

    expect(request).toHaveBeenCalledOnce()
    expect(request).toHaveBeenCalledWith({
      type: "permission.reply",
      sessionId: "session-1",
      permissionId: "permission-1",
      response: "once",
    })
    expect(onError).not.toHaveBeenCalled()
  })
})
