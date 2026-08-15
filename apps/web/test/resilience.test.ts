import { describe, expect, it } from "vitest"
import { addChunk, assembledMessages, completeChunks, connectionLabel, createChunkAssembly, effectiveConnectionPresentation, exactConnectionTime, exactManifestMessages, hasSequenceGap, healthSummary, isTransportActivityStale, mergeByMessageId, orderByManifest, promptDeliveryState, reconcileCanonicalMessages, reconnectDelay, relayConnectionPresentation, requestInactivityMs, retryPlan, serviceConnectionPresentation, shouldExpireHandshakeWatchdog, shouldReconnectTransportOnResume, shouldReplaceTransportOnResume, validManifest } from "../src/resilience"
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

  it("presents a connected timed-out relay as the unstable source", () => {
    const overall = effectiveConnectionPresentation("online", ["relay-a"], 1, { "relay-a": { timedOut: true, lastContact: 8_000, rtt: 42 } })
    expect(overall).toMatchObject({ state: "unstable", label: "Unstable", tone: "unstable", hasTimedOutRelay: true })
    expect(relayConnectionPresentation(true, { timedOut: true, lastContact: 8_000, rtt: 42 }, 10_000)).toEqual({
      state: "unstable", label: "Unstable", detail: "Last contact 2 seconds ago",
    })
    expect(serviceConnectionPresentation(true, overall)).toMatchObject({ state: "online", label: "Connected" })
  })

  it("attributes raw transport instability to the service row when no relay is timed out", () => {
    const overall = effectiveConnectionPresentation("unstable", ["relay-a"], 1, { "relay-a": { timedOut: false } })
    expect(overall).toMatchObject({ state: "unstable", hasTimedOutRelay: false })
    expect(serviceConnectionPresentation(true, overall)).toMatchObject({ state: "unstable", label: "Unstable" })
  })

  it("ignores retained timeout health for disconnected relays", () => {
    const overall = effectiveConnectionPresentation("online", ["relay-b"], 2, {
      "relay-a": { timedOut: true },
      "relay-b": { timedOut: false },
    })
    expect(overall).toMatchObject({ state: "online", label: "Live", hasTimedOutRelay: false })
  })

  it("keeps zero RTT for healthy relay rows", () => {
    expect(relayConnectionPresentation(true, { rtt: 0, lastContact: 8_000 }, 10_000)).toEqual({
      state: "online", label: "Connected", detail: "0 ms",
    })
  })

  it("replaces unhealthy transports after resumptions without replacing brief open sockets", () => {
    expect(shouldReplaceTransportOnResume({ socketOpen: false, now: 10_000 })).toBe(true)
    expect(shouldReplaceTransportOnResume({ socketOpen: true, now: 10_000, hiddenAt: 6_000, lastTransportActivity: 5_000 })).toBe(false)
    expect(shouldReplaceTransportOnResume({ socketOpen: true, now: 10_000, hiddenAt: 5_000 })).toBe(true)
    expect(shouldReplaceTransportOnResume({ socketOpen: true, now: 10_000, persisted: true, lastTransportActivity: 9_999 })).toBe(false)
    expect(shouldReplaceTransportOnResume({ socketOpen: true, now: 10_000, persisted: true, lastTransportActivity: 5_000 })).toBe(true)
    expect(shouldReplaceTransportOnResume({ socketOpen: true, now: 10_000, online: true, lastTransportActivity: 9_999 })).toBe(true)
    expect(shouldReplaceTransportOnResume({ socketOpen: true, now: 10_000, lastTransportActivity: 5_000 })).toBe(false)
    expect(shouldReplaceTransportOnResume({ socketOpen: true, now: 10_000, hiddenAt: 9_999, lastTransportActivity: 9_999 })).toBe(false)
    expect(shouldReconnectTransportOnResume(true, { socketOpen: false, now: 10_000, online: true })).toBe(false)
    expect(shouldReconnectTransportOnResume(true, { socketOpen: true, now: 10_000, persisted: true, lastTransportActivity: 5_000 })).toBe(false)
    expect(isTransportActivityStale(5_000, 10_000)).toBe(true)
    expect(isTransportActivityStale(9_999, 10_000)).toBe(false)
  })

  it("expires only an unauthenticated watchdog that owns the socket generation", () => {
    expect(shouldExpireHandshakeWatchdog(3, 3, false)).toBe(true)
    expect(shouldExpireHandshakeWatchdog(3, 4, false)).toBe(false)
    expect(shouldExpireHandshakeWatchdog(3, 3, true)).toBe(false)
  })

  it("formats exact modal connection timing", () => {
    expect(exactConnectionTime(10_000, 10_000)).toBe("0 ms ago")
    expect(exactConnectionTime(9_001, 10_000)).toBe("999 ms ago")
    expect(exactConnectionTime(9_000, 10_000)).toBe("1 second ago")
    expect(exactConnectionTime(-49_000, 10_000)).toBe("59 seconds ago")
    expect(exactConnectionTime(-51_000, 10_000)).toBe("61 seconds ago")
    expect(exactConnectionTime(11_000, 10_000)).toBe("0 ms ago")
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
    expect(exactManifestMessages([user, tool], ["tool", "user"])).toEqual([tool, user])
    expect(exactManifestMessages([user, user], ["tool", "user"])).toBeUndefined()
    expect(exactManifestMessages([user], ["tool", "user"])).toBeUndefined()
    expect(validManifest({ manifest: true, ids: ["tool", "user"], total: 2 })).toEqual({ ids: ["tool", "user"], total: 2 })
    expect(validManifest({ manifest: true, ids: ["same", "same"], total: 2 })).toBeUndefined()
  })

  it("classifies state-changing interruptions as uncertain delivery", () => {
    expect(promptDeliveryState("Connection interrupted")).toBe("uncertain")
    expect(promptDeliveryState("OpenCode request failed")).toBe("failed")
    expect(promptDeliveryState("The workspace relay disconnected")).toBe("uncertain")
    expect(promptDeliveryState("Socket replaced")).toBe("uncertain")
  })

  it("never forwards browser-local message ids to OpenCode relays", () => {
    const command = { type: "session.prompt" as const, sessionId: "s", text: "hello", messageId: "msg_browser-id" }
    expect(commandForRelayCapabilities(command, {})).not.toHaveProperty("messageId")
    expect(commandForRelayCapabilities(command, { promptMessageId: 1 })).not.toHaveProperty("messageId")
    expect(commandForRelayCapabilities(command, { relayPromptMessageId: 1 })).not.toHaveProperty("messageId")
  })


  it("falls back to the legacy session diff for older relays", () => {
    const command = { type: "workspace.diff" as const, sessionId: "session-1" }
    expect(commandForRelayCapabilities(command, {})).toEqual({ type: "session.diff", sessionId: "session-1" })
    expect(commandForRelayCapabilities(command, { workspaceDiff: 1 })).toEqual(command)
  })
})
