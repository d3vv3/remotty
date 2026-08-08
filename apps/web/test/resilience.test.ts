import { describe, expect, it } from "vitest"
import { addChunk, assembledMessages, completeChunks, connectionLabel, createChunkAssembly, hasSequenceGap, healthSummary, mergeByMessageId, orderByManifest, promptDeliveryState, reconcileCanonicalMessages, reconnectDelay, requestInactivityMs, retryPlan, validManifest } from "../src/resilience"
import { commandForRelayCapabilities } from "../src/useRelay"

describe("bad network helpers", () => {
  it("bounds deterministic exponential reconnect delays with jitter", () => {
    expect(reconnectDelay(0, () => 0)).toBe(800)
    expect(reconnectDelay(1, () => 1)).toBe(2400)
    expect(reconnectDelay(20, () => 1)).toBe(36_000)
  })

  it("labels freshness and detects sequence gaps", () => {
    expect(connectionLabel("online", 1, false)).toBe("Live")
    expect(connectionLabel("online", 1, true)).toBe("Unstable")
    expect(hasSequenceGap(4, 6)).toBe(true)
    expect(hasSequenceGap(4, 5)).toBe(false)
  })

  it("merges chunk retries and optimistic messages by stable id", () => {
    const older = { info: { id: "one", time: { created: 1 } }, parts: [] }
    const updated = { info: { id: "one", time: { created: 1 } }, parts: [{ type: "text", text: "sent" }] }
    const newer = { info: { id: "two", time: { created: 2 } }, parts: [] }
    expect(mergeByMessageId([older, newer], [updated, newer])).toEqual([updated, newer])
  })

  it("requires complete valid chunk indexes before resolving unicode fragments", () => {
    const bytes = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify({ info: { id: "m", time: { created: 1 } }, parts: [{ text: "\u{1f680}" }] }))))
    const state = createChunkAssembly()
    expect(addChunk(state, { index: 1, total: 2, result: [] })).toBe(true)
    expect(completeChunks(state)).toBe(false)
    expect(addChunk(state, { index: 0, total: 2, result: { fragment: { messageId: "m", index: 0, total: 1, bytes } } })).toBe(true)
    expect(completeChunks(state)).toBe(true)
    expect(assembledMessages(state)).toHaveLength(1)
    expect(addChunk(createChunkAssembly(), { index: 2, total: 2, result: [] })).toBe(false)
  })

  it("does not accept sparse fragment holes, conflicting duplicates, or oversized bodies", () => {
    const state = createChunkAssembly()
    const bytes = btoa('{"info":{"id":"m"}}')
    expect(addChunk(state, { index: 0, total: 2, result: { fragment: { messageId: "m", index: 1, total: 2, bytes } } })).toBe(true)
    expect(completeChunks(state)).toBe(false)
    expect(addChunk(state, { index: 1, total: 2, result: { fragment: { messageId: "m", index: 1, total: 2, bytes: btoa("different") } } })).toBe(false)
    const large = btoa("x".repeat(7 * 1024 * 1024 + 1))
    expect(addChunk(createChunkAssembly(), { index: 0, total: 1, result: { fragment: { messageId: "m", index: 0, total: 1, bytes: large } } })).toBe(false)
  })

  it("completes out-of-order chunks without depending on done", () => {
    const state = createChunkAssembly()
    expect(addChunk(state, { index: 1, total: 2, result: [{ info: { id: "later" } }] })).toBe(true)
    expect(addChunk(state, { index: 0, total: 2, result: [{ info: { id: "first" } }] })).toBe(true)
    expect(completeChunks(state)).toBe(true)
  })

  it("bounds reconnect retries", () => {
    expect(retryPlan(1, 2, 0)).toBe(true)
    expect(retryPlan(2, 2, 0)).toBe(false)
    expect(retryPlan(1, 2, 2)).toBe(false)
  })

  it("reconciles canonical messages while preserving failed optimistic records", () => {
    const sending = { info: { id: "one", time: { created: 1 }, delivery: "accepted" }, parts: [{ text: "phone" }] }
    const canonical = { info: { id: "one", time: { created: 1 } }, parts: [{ text: "OpenCode" }] }
    const failed = { info: { id: "two", time: { created: 2 }, delivery: "failed" }, parts: [{ text: "keep" }] }
    expect(mergeByMessageId([sending, failed], [canonical])).toEqual([canonical, failed])
  })

  it("preserves canonical order regardless of time and appends local-only uncertain messages", () => {
    const optimistic = { info: { id: "one", time: { created: 9 }, delivery: "accepted" }, parts: [{ text: "phone" }] }
    const uncertain = { info: { id: "local", time: { created: 0 }, delivery: "uncertain" }, parts: [{ text: "keep" }] }
    const canonical = [
      { info: { id: "two", time: { created: 1 } }, parts: [] },
      { info: { id: "one" }, parts: [{ text: "canonical" }] },
      { info: { id: "three", time: { created: 1 } }, parts: [] },
    ]
    const result = reconcileCanonicalMessages([optimistic, uncertain], canonical)
    expect(result.map((message) => message.info.id)).toEqual(["two", "one", "three", "local"])
    expect(result[1]?.info).not.toHaveProperty("delivery")
  })

  it("keeps accepted prompts awaiting a later authoritative sync", () => {
    const accepted = { info: { id: "accepted", delivery: "accepted" }, parts: [] }
    expect(reconcileCanonicalMessages([accepted], [])).toEqual([accepted])
  })

  it("uses transfer inactivity timeouts and per-relay health", () => {
    expect(requestInactivityMs("session.messages")).toBeGreaterThan(requestInactivityMs("relay.ping"))
    expect(healthSummary(["a", "b"], { a: { timedOut: true }, b: { timedOut: false } })).toBe(true)
    expect(healthSummary(["b"], { a: { timedOut: true }, b: { timedOut: false } })).toBe(false)
  })

  it("orders priority-arrival progress by the canonical manifest and rejects invalid manifests", () => {
    const tool = { info: { id: "tool" }, parts: [] }
    const user = { info: { id: "user" }, parts: [] }
    expect(orderByManifest([user, tool], ["tool", "user"])).toEqual([tool, user])
    expect(validManifest({ manifest: true, ids: ["tool", "user"], total: 2 })).toEqual({ ids: ["tool", "user"], total: 2 })
    expect(validManifest({ manifest: true, ids: ["same", "same"], total: 2 })).toBeUndefined()
  })

  it("marks interrupted prompt acknowledgement as uncertain", () => {
    expect(promptDeliveryState("Connection interrupted")).toBe("uncertain")
    expect(promptDeliveryState("OpenCode request failed")).toBe("failed")
    expect(promptDeliveryState("The workspace relay disconnected")).toBe("uncertain")
    expect(promptDeliveryState("Socket replaced")).toBe("uncertain")
  })

  it("strips browser message ids for old prompt relays", () => {
    const command = { type: "session.prompt" as const, sessionId: "s", text: "hello", messageId: "browser-id" }
    expect(commandForRelayCapabilities(command, {})).not.toHaveProperty("messageId")
    expect(commandForRelayCapabilities(command, { promptMessageId: 1 })).toMatchObject({ messageId: "browser-id" })
  })
})
