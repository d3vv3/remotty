import { describe, expect, it } from "vitest"
import { brokerMessageSchema, canonicalJsonFingerprint, canonicalMessageValue, clientCommandSchema, relayMessageSchema } from "../src/index"

describe("relay protocol", () => {
  it("accepts an authenticated device revocation message", () => {
    expect(relayMessageSchema.parse({ type: "device.revoked", deviceId: "device-1" })).toEqual({
      type: "device.revoked",
      deviceId: "device-1",
    })
  })

  it("accepts an optional device label with snapshot requests", () => {
    expect(clientCommandSchema.parse({
      type: "snapshot.request",
      requestId: "request-1",
      deviceName: "Safari on iPadOS (abcdef)",
    })).toMatchObject({ deviceName: "Safari on iPadOS (abcdef)" })
  })

  it("accepts a valid prompt command", () => {
    expect(
      clientCommandSchema.parse({
        type: "session.prompt",
        requestId: "request-1",
        sessionId: "session-1",
        text: "Continue the task",
        agent: "build",
        messageId: "msg_phone-message-1",
      }),
    ).toMatchObject({ type: "session.prompt", agent: "build" })
  })

  it("accepts workspace-scoped session creation without remote path controls", () => {
    expect(clientCommandSchema.parse({ type: "session.create", requestId: "request-1" })).toEqual({
      type: "session.create",
      requestId: "request-1",
    })
    expect(clientCommandSchema.parse({ type: "session.create", requestId: "request-1", directory: "/tmp" }))
      .not.toHaveProperty("directory")
  })

  it("accepts a session-routed workspace diff request", () => {
    expect(clientCommandSchema.parse({ type: "workspace.diff", requestId: "request-1", sessionId: "session-1" })).toEqual({
      type: "workspace.diff",
      requestId: "request-1",
      sessionId: "session-1",
    })
    expect(clientCommandSchema.parse({ type: "workspace.diff.patch", requestId: "request-2", sessionId: "session-1", file: "src/app.ts" })).toMatchObject({
      type: "workspace.diff.patch",
      file: "src/app.ts",
    })
  })

  it("accepts health requests and independently encrypted response chunks", () => {
    expect(clientCommandSchema.parse({ type: "relay.ping", requestId: "ping-1", sentAt: 1 })).toMatchObject({ type: "relay.ping" })
    expect(relayMessageSchema.parse({ type: "rpc.chunk", requestId: "messages-1", index: 0, total: 1, done: true, result: [] })).toMatchObject({ type: "rpc.chunk", done: true })
  })

  it("keeps optional capabilities and chunking compatible with legacy peers", () => {
    expect(clientCommandSchema.parse({ type: "session.messages", requestId: "m", sessionId: "s" })).not.toHaveProperty("chunked")
    expect(clientCommandSchema.parse({ type: "session.messages", requestId: "m", sessionId: "s", chunked: true })).toMatchObject({ chunked: true })
    expect(relayMessageSchema.parse({ type: "relay.hello", relay: { id: "r", name: "n", hostname: "h", platform: "p", arch: "a", workspace: "w", workspaceId: "stable", capabilities: { ping: true, relayPromptMessageId: 1, sessionCreate: 1, workspaceDiff: 1 } } })).toMatchObject({ type: "relay.hello", relay: { capabilities: { relayPromptMessageId: 1, sessionCreate: 1, workspaceDiff: 1 } } })
  })

  it("fingerprints canonical JSON and excludes local delivery metadata", async () => {
    const first = await canonicalJsonFingerprint({ b: "\u{1f680}", a: [1, true] })
    expect(first).toHaveLength(43)
    expect(first).toBe(await canonicalJsonFingerprint({ a: [1, true], b: "\u{1f680}" }))
    expect(first).not.toBe(await canonicalJsonFingerprint({ a: [1, false], b: "\u{1f680}" }))
    const message = { info: { id: "m", delivery: "accepted" }, parts: [{ text: "hello" }] }
    expect(await canonicalJsonFingerprint(canonicalMessageValue(message))).toBe(await canonicalJsonFingerprint({ info: { id: "m" }, parts: [{ text: "hello" }] }))
    expect(message.info.delivery).toBe("accepted")
    expect(canonicalMessageValue({ info: { id: "m", legacyPrompt: true }, parts: [] })).toEqual({ info: { id: "m" }, parts: [] })
  })

  it("validates bounded delta inventory and payloads", () => {
    const fingerprint = "a".repeat(43)
    expect(clientCommandSchema.parse({ type: "session.messages", requestId: "m", sessionId: "s", sync: { version: 1, known: [{ id: "one", fingerprint }] } })).toMatchObject({ sync: { version: 1 } })
    expect(() => clientCommandSchema.parse({ type: "session.messages", requestId: "m", sessionId: "s", sync: { version: 1, known: [{ id: "one", fingerprint }, { id: "one", fingerprint }] } })).toThrow()
  })

  it("requires non-empty valid delta chunk indices", () => {
    const fingerprint = "a".repeat(43)
    expect(() => relayMessageSchema.parse({ type: "session.messages.chunk", chunk: { requestId: "r", snapshotId: fingerprint, index: 0, total: 0, records: [], fragments: [] } })).toThrow()
    expect(() => relayMessageSchema.parse({ type: "session.messages.chunk", chunk: { requestId: "r", snapshotId: fingerprint, index: 1, total: 1, records: [{ id: "m", fingerprint, message: {} }] } })).toThrow()
  })

  it("rejects an empty prompt", () => {
    expect(() =>
      clientCommandSchema.parse({
        type: "session.prompt",
        requestId: "request-1",
        sessionId: "session-1",
        text: "   ",
      }),
    ).toThrow()
  })

  it("accepts a todo request", () => {
    expect(
      clientCommandSchema.parse({
        type: "session.todos",
        requestId: "request-1",
        sessionId: "session-1",
      }),
    ).toMatchObject({ type: "session.todos" })
  })

  it("accepts a metadata-only snapshot", () => {
    expect(
      relayMessageSchema.parse({
        type: "relay.snapshot",
        relay: {
          id: "relay-1",
          name: "Laptop",
          hostname: "devbox",
          platform: "linux",
          arch: "x64",
          workspace: "/work/app",
        },
        sessions: [],
        questions: [],
      }),
    ).toMatchObject({ type: "relay.snapshot" })
  })

  it("normalizes a detached workspace branch", () => {
    const snapshot = relayMessageSchema.parse({
      type: "relay.snapshot",
      relay: {
        id: "relay-1",
        name: "Laptop",
        hostname: "devbox",
        platform: "linux",
        arch: "x64",
        workspace: "/work/app",
      },
      sessions: [
        {
          id: "session-1",
          title: "Relay session",
          directory: "/work/app",
          branch: null,
          status: "busy",
          updatedAt: 1,
        },
      ],
    })

    expect(snapshot.type).toBe("relay.snapshot")
    if (snapshot.type === "relay.snapshot") expect(snapshot.sessions[0]?.branch).toBeUndefined()
  })

  it("accepts agents and pending permissions in a snapshot", () => {
    expect(
      relayMessageSchema.parse({
        type: "relay.snapshot",
        relay: {
          id: "relay-1",
          name: "Laptop",
          hostname: "devbox",
          platform: "linux",
          arch: "x64",
          workspace: "/work/app",
        },
        sessions: [],
        agents: [{ name: "build", mode: "primary" }],
        permissions: [
          {
            id: "permission-1",
            sessionID: "session-1",
            permission: "bash",
            patterns: ["git status"],
          },
        ],
      }),
    ).toMatchObject({
      agents: [{ name: "build" }],
      permissions: [{ permission: "bash", patterns: ["git status"] }],
    })
  })

  it("accepts a combined broker snapshot", () => {
    expect(
      brokerMessageSchema.parse({
        type: "broker.snapshot",
        relays: [
          {
            id: "relay-1",
            name: "Laptop",
            hostname: "devbox",
            platform: "linux",
            arch: "x64",
            workspace: "/work/app",
          },
        ],
        sessions: [],
        agents: [],
        permissions: [],
        questions: [],
      }),
    ).toMatchObject({ type: "broker.snapshot", relays: [{ workspace: "/work/app" }] })
  })

  it("routes question replies with their session", () => {
    expect(
      clientCommandSchema.parse({
        type: "question.reply",
        requestId: "request-1",
        sessionId: "session-1",
        questionId: "question-1",
        answers: [["Yes"]],
      }),
    ).toMatchObject({ sessionId: "session-1" })
  })
})
