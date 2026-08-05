import { describe, expect, it } from "vitest"
import { brokerMessageSchema, clientCommandSchema, relayMessageSchema } from "../src/index"

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
      }),
    ).toMatchObject({ type: "session.prompt", agent: "build" })
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
