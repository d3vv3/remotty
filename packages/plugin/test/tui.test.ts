import { describe, expect, it, vi } from "vitest"
import plugin, { agentThemeFingerprint, agentThemeSnapshot, rgbaToHex, selectedSessionId, setupTuiRelay, shouldPublishAgentTheme } from "../src/tui"
import serverPlugin from "../src/index"
import { createSnapshotQueue, isEventForDirectory, isRemotelyAnswerableForm, normalizeRelayEvent, questionFromForm, v2Todos } from "../src/relayRuntime"
import { questionRequestSchema } from "@remotty/protocol"

describe("v2 TUI plugin", () => {
  it("exports a v2 definition with a setup lifecycle", () => {
    expect(plugin).toMatchObject({ id: "remotty", setup: expect.any(Function) })
  })

  it("keeps the server entrypoint side-effect-free and discoverable", () => {
    expect(serverPlugin).toMatchObject({ id: "remotty", setup: expect.any(Function) })
  })

  it("reads only the v2 session route", () => {
    expect(selectedSessionId({ type: "home" })).toBeUndefined()
    expect(selectedSessionId({ type: "session", sessionID: "session-1" })).toBe("session-1")
  })
})

describe("v2 form mapping", () => {
  it("normalizes typed v2 form fields into the stable question payload", () => {
    const question = questionFromForm({
      id: "form-1", sessionID: "session-1", title: "Choose", fields: [
        { key: "scope", type: "multiselect", options: [{ value: "src", label: "Source", description: "Source files" }] },
        { key: "note", type: "string", title: "Note", description: "Optional note" },
      ],
    } as never)
    expect(questionRequestSchema.parse(question)).toEqual({
      id: "form-1", sessionID: "session-1", questions: [
        { question: "scope", header: "Choose", options: [{ label: "src", description: "Source files" }], multiple: true },
        { question: "Optional note", header: "Note", options: [], custom: true },
      ],
    })
  })

  it("does not expose forms with external fields for remote answers or notifications", () => {
    const external = {
      id: "form-external", sessionID: "session-1", title: "Connect", fields: [
        { key: "browser", type: "external", url: "https://example.com" },
      ],
    }
    expect(isRemotelyAnswerableForm(external)).toBe(false)
    expect(() => questionFromForm(external as never)).toThrow("cannot be completed remotely")
    expect(normalizeRelayEvent({ type: "form.created", data: { form: external } } as never)).toBeUndefined()
  })

  it("uses an empty v2 todos result to clear stale PWA state", () => {
    expect(v2Todos()).toEqual([])
  })
})

describe("v2 relay event normalization", () => {
  const event = (type: string, data: Record<string, unknown>) => normalizeRelayEvent({ type, data } as never)

  it("maps remotely answerable forms to questions and form completion to question lifecycle events", () => {
    expect(event("form.created", { form: { id: "form-1", sessionID: "session-1", title: "Choose", fields: [{ key: "name", type: "string" }] } })).toMatchObject({
      type: "question.asked", properties: { id: "form-1", sessionID: "session-1" },
    })
    expect(event("form.replied", { requestID: "form-1", sessionID: "session-1" })).toEqual({ type: "question.replied", properties: { requestID: "form-1", sessionID: "session-1" } })
    expect(event("form.cancelled", { requestID: "form-1", sessionID: "session-1" })).toEqual({ type: "question.rejected", properties: { requestID: "form-1", sessionID: "session-1" } })
  })

  it("maps execution lifecycle events to PWA session state", () => {
    expect(event("session.execution.started", { sessionID: "session-1" })).toEqual({ type: "session.status", properties: { sessionID: "session-1", status: { type: "busy" } } })
    expect(event("session.execution.succeeded", { sessionID: "session-1" })).toEqual({ type: "session.idle", properties: { sessionID: "session-1" } })
    expect(event("session.execution.interrupted", { sessionID: "session-1" })).toEqual({ type: "session.idle", properties: { sessionID: "session-1" } })
    expect(event("session.execution.failed", { sessionID: "session-1", error: "failed" })).toEqual({ type: "session.error", properties: { sessionID: "session-1", error: "failed" } })
  })

  it.each(["session.text.delta", "session.reasoning.delta", "session.tool.updated", "session.step.started", "session.message.content.updated"])("maps %s activity to a message refresh", (type) => {
    expect(event(type, { part: { sessionID: "session-1" } })).toEqual({ type: "message.updated", properties: { sessionID: "session-1" } })
  })

  it("passes existing relay events through unchanged", () => {
    expect(event("permission.asked", { id: "permission-1", sessionID: "session-1" })).toEqual({ type: "permission.asked", properties: { id: "permission-1", sessionID: "session-1" } })
    expect(event("session.status", { sessionID: "session-1", status: { type: "idle" } })).toEqual({ type: "session.status", properties: { sessionID: "session-1", status: { type: "idle" } } })
    expect(event("unrelated.event", { value: true })).toEqual({ type: "unrelated.event", properties: { value: true } })
  })

  it("accepts unlocated events and rejects events for another directory", () => {
    expect(isEventForDirectory({ type: "session.execution.started", data: {} }, "/workspace")).toBe(true)
    expect(isEventForDirectory({ location: { directory: "/workspace" } }, "/workspace")).toBe(true)
    expect(isEventForDirectory({ location: { directory: "/other" } }, "/workspace")).toBe(false)
  })
})

describe("snapshot ordering", () => {
  it("serializes inverse completion candidates before publication", async () => {
    const queue = createSnapshotQueue()
    const published: string[] = []
    let releaseFirst: (() => void) | undefined
    const first = queue(async () => {
      await new Promise<void>((resolve) => { releaseFirst = resolve })
      published.push("first")
    })
    const second = queue(async () => { published.push("second") })

    await Promise.resolve()
    expect(published).toEqual([])
    expect(releaseFirst).toBeTypeOf("function")
    releaseFirst?.()
    await Promise.all([first, second])
    expect(published).toEqual(["first", "second"])
  })
})

describe("TUI relay ownership", () => {
  it("keeps the newer concurrent setup and cleans a late older relay", async () => {
    const owner: { token?: symbol; cleanup?: () => Promise<void>; stopping?: Promise<void> } = {}
    const mutate = (change: (draft: typeof owner) => void) => change(owner)
    const api = {
      location: { directory: process.cwd() },
      storage: { memory: () => [owner, mutate] },
      ui: { router: { current: () => ({ type: "home" }) } },
      data: { listen: () => () => undefined },
      client: {}, theme: {}, themeMode: "dark",
    } as never
    let resolveFirst: ((cleanup: () => Promise<void>) => void) | undefined
    const oldCleanup = vi.fn(async () => undefined)
    const newCleanup = vi.fn(async () => undefined)
    const start = vi.fn()
      .mockImplementationOnce(() => new Promise<() => Promise<void>>((resolve) => { resolveFirst = resolve }))
      .mockResolvedValueOnce(newCleanup)

    const older = setupTuiRelay(api, start)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(start).toHaveBeenCalledOnce()
    const newer = setupTuiRelay(api, start)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(start).toHaveBeenCalledOnce()
    resolveFirst?.(oldCleanup)

    const [disposeOlder, disposeNewer] = await Promise.all([older, newer])
    expect(start).toHaveBeenCalledTimes(2)
    expect(oldCleanup).toHaveBeenCalledOnce()
    await disposeOlder?.()
    expect(newCleanup).not.toHaveBeenCalled()
    await disposeNewer?.()
    await disposeNewer?.()
    expect(newCleanup).toHaveBeenCalledOnce()
  })
})

describe("agent theme snapshot", () => {
  const color = (values: [number, number, number, number]) => ({ toInts: () => values })

  it("preserves alpha only when needed and clamps invalid color bytes", () => {
    expect(rgbaToHex(color([1, 2, 3, 255]))).toBe("#010203")
    expect(rgbaToHex(color([1, 2, 3, 4]))).toBe("#01020304")
    expect(rgbaToHex(color([-1, 999, Number.NaN, 255]))).toBe("#00ff00")
  })

  it("builds a stable privacy-safe theme payload", () => {
    const theme = agentThemeSnapshot("custom", "light", {
      secondary: color([1, 2, 3, 255]), accent: color([4, 5, 6, 255]), success: color([7, 8, 9, 255]),
      warning: color([10, 11, 12, 255]), primary: color([13, 14, 15, 255]), error: color([16, 17, 18, 255]), info: color([19, 20, 21, 255]),
    })
    expect(theme).toEqual({
      name: "custom", mode: "light",
      colors: { secondary: "#010203", accent: "#040506", success: "#070809", warning: "#0a0b0c", primary: "#0d0e0f", error: "#101112", info: "#131415" },
    })
    expect(agentThemeFingerprint(theme)).toBe(agentThemeFingerprint({ ...theme }))
    expect(shouldPublishAgentTheme("theme", undefined, "theme")).toBe(false)
    expect(shouldPublishAgentTheme(undefined, undefined, "theme")).toBe(true)
  })
})
