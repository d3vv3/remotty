import {
  generateEncryptionKeyPair,
  generateSigningKeyPair,
  openJsonPayload,
  sealJsonPayload,
  signingKeyFingerprint,
} from "@remotty/protocol"
import { webcrypto } from "node:crypto"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import { afterEach, describe, expect, it, vi } from "vitest"

const source = readFileSync(new URL("../public/notification-sw.js", import.meta.url), "utf8")

describe("notification body click window selection", () => {
  afterEach(() => vi.useRealTimers())
  const setup = () => {
    vi.useFakeTimers()
    const ports: { close: ReturnType<typeof vi.fn> }[] = []
    class Channel {
      port1 = { onmessage: null as null | ((event: { data: unknown }) => void), onmessageerror: null as null | (() => void), close: vi.fn() }
      port2 = { close: vi.fn(), postMessage: (data: unknown) => this.port1.onmessage?.({ data }) }
      constructor() { ports.push(this.port1, this.port2) }
    }
    const candidate = (standalone: boolean | undefined, ready = true, url = "https://app.example/app") => ({
      url, navigate: vi.fn(), focus: vi.fn().mockResolvedValue(undefined),
      postMessage: vi.fn((data, transfer) => {
        if (data.type.endsWith("probe") && standalone !== undefined) transfer[0].postMessage({ type: "notification.navigation.ready", version: 1, standalone, ready })
      }),
    })
    const clients = { matchAll: vi.fn().mockResolvedValue([]), openWindow: vi.fn() }
    const handlers: Record<string, (event: unknown) => void> = {}
    runInNewContext(source, { TextEncoder, TextDecoder, URL, setTimeout, clearTimeout, MessageChannel: Channel, clients,
      self: { location: { origin: "https://app.example" }, addEventListener: (name: string, handler: (event: unknown) => void) => { handlers[name] = handler } },
    })
    const click = (action = "", data: unknown = { workspaceId: "workspace", sessionId: "session" }) => {
      let done: Promise<unknown> = Promise.resolve()
      handlers.notificationclick({ action, notification: { data, close: vi.fn() }, waitUntil: (promise: Promise<unknown>) => { done = promise } })
      return done
    }
    return { clients, candidate, ports, click }
  }

  it("chooses the first ready standalone in focus order, without navigating any window", async () => {
    const { clients, candidate, ports, click } = setup()
    const browser = candidate(false), installed = candidate(true), older = candidate(true)
    clients.matchAll.mockResolvedValue([browser, installed, older])
    await click()
    expect(installed.focus).toHaveBeenCalledOnce()
    expect(installed.postMessage).toHaveBeenLastCalledWith({ type: "notification.navigation.open", version: 1, sessionKey: "workspace:session" })
    expect(installed.focus.mock.invocationCallOrder[0]).toBeLessThan(installed.postMessage.mock.invocationCallOrder[1])
    for (const client of [browser, installed, older]) expect(client.navigate).not.toHaveBeenCalled()
    expect(browser.focus).not.toHaveBeenCalled()
    expect(older.focus).not.toHaveBeenCalled()
    expect(clients.openWindow).not.toHaveBeenCalled()
    expect(ports.every((port) => port.close.mock.calls.length === 1)).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("uses one bounded deadline for unresponsive or closed ports and cleans up", async () => {
    const { clients, candidate, ports, click } = setup()
    clients.matchAll.mockResolvedValue([candidate(undefined), candidate(undefined)])
    const done = click()
    await vi.advanceTimersByTimeAsync(249)
    expect(clients.openWindow).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await done
    expect(clients.openWindow).toHaveBeenCalledExactlyOnceWith("https://app.example/app?session=workspace%3Asession")
    expect(ports.every((port) => port.close.mock.calls.length === 1)).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("opens a native window when only browser, unenrolled, or foreign clients exist", async () => {
    const { clients, candidate, click } = setup()
    const browser = candidate(false), pending = candidate(true, false), foreign = candidate(true, true, "https://evil.example/app")
    clients.matchAll.mockResolvedValue([browser, pending, foreign])
    await click()
    expect(clients.openWindow).toHaveBeenCalledOnce()
    expect(browser.focus).not.toHaveBeenCalled()
    expect(pending.focus).not.toHaveBeenCalled()
    expect(foreign.postMessage).not.toHaveBeenCalled()
  })

  it.each(["focus", "probe", "route"])("falls back after a client %s failure", async (failure) => {
    const { clients, candidate, click } = setup()
    const installed = candidate(true)
    if (failure === "focus") installed.focus.mockRejectedValue(new Error("closed"))
    if (failure === "probe") installed.postMessage.mockImplementation(() => { throw new Error("closed") })
    if (failure === "route") installed.postMessage.mockImplementation((data, transfer) => {
      if (data.type.endsWith("open")) throw new Error("closed")
      transfer[0].postMessage({ type: "notification.navigation.ready", version: 1, standalone: true, ready: true })
    })
    clients.matchAll.mockResolvedValue([installed])
    await click()
    expect(clients.openWindow).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("does not open UI for action clicks", async () => {
    const { clients, click } = setup()
    await click("once") // Missing permission ID: action handler exits without a request.
    await click("unknown")
    expect(clients.matchAll).not.toHaveBeenCalled()
    expect(clients.openWindow).not.toHaveBeenCalled()
  })
})

const workerCrypto = () => {
  const context = {
    atob,
    btoa,
    console,
    crypto: webcrypto,
    TextDecoder,
    TextEncoder,
    URL,
    clients: {},
    indexedDB: {},
    self: {
      addEventListener: () => undefined,
      location: { origin: "https://app.example" },
      registration: {},
    },
  } as Record<string, unknown>
  runInNewContext(`${source}\nglobalThis.workerCrypto = { verifyAndOpen, sealCommand, applicationUrl, notificationClickMode }`, context)
  return context.workerCrypto as {
    verifyAndOpen: (frame: unknown, identity: unknown) => Promise<unknown>
    sealCommand: (command: unknown, identity: unknown, relayId: string) => Promise<unknown>
    applicationUrl: (data: unknown) => URL
    notificationClickMode: (action: string) => "action" | "open"
  }
}

describe("notification service worker security boundary", () => {
  it("passes versioned local branding to the notification API after opening a payload", async () => {
    const showNotification = vi.fn()
    // Isolate rendering from IndexedDB and crypto, which have separate coverage below.
    const renderingSource = source.replace(/const (currentIdentity|verifyAndOpen|rememberMessage) =/g, "const unused_$1 =")
    const context = {
      TextEncoder, TextDecoder,
      self: { addEventListener: vi.fn(), registration: { showNotification } },
      currentIdentity: async () => ({ enrolled: true, key: "device" }),
      rememberMessage: async () => true,
      verifyAndOpen: async () => ({ type: "notification.show", title: "Ready", body: "Finished", tag: "session", actions: [], data: { workspaceRelayId: "relay" }, icon: "/old-icon.png", image: "/old-image.png" }),
    }
    await runInNewContext(`${renderingSource}\nhandlePush({ sender: "relay", messageId: "message", issuedAt: 1 })`, context)
    expect(showNotification).toHaveBeenCalledWith("Ready", expect.objectContaining({ icon: "/notification-icon-v2.png", badge: "/notification-badge-v2.png" }))
    expect(showNotification.mock.calls[0][1]).not.toHaveProperty("image")
  })

  it("posts only an opaque frame for permission actions", () => {
    expect(source).toContain('const DB_VERSION = 2')
    expect(source).toContain('database.createObjectStore("cache", { keyPath: "key" })')
    expect(source).toContain("console.error(\"Remotty notification processing failed\"")
    expect(source).toContain("body: JSON.stringify({ roomToken: identity.roomToken, frame })")
    expect(source).not.toContain("code: data.code")
    expect(source).not.toContain("brokerUrl: data.brokerUrl")
    expect(source).toContain("event.preventDefault?.()")
    expect(source).toContain("event.stopImmediatePropagation?.()")
    expect(source).toContain('typeof data.targetSessionId === "string" ? data.targetSessionId : data.sessionId')
    expect(source).toContain('icon: "/notification-icon-v2.png"')
    expect(source).toContain('badge: "/notification-badge-v2.png"')
  })

  it("opens the source session for notification body clicks", () => {
    const worker = workerCrypto()
    expect(worker.notificationClickMode("once")).toBe("action")
    expect(worker.notificationClickMode("")).toBe("open")
    expect(worker.applicationUrl({ workspaceRelayId: "relay-1", workspaceId: "stable-1", sessionId: "session-1" }).href)
      .toBe("https://app.example/app?session=stable-1%3Asession-1")
  })

  it("verifies, decrypts, and rejects stale Push frames", () => {
    expect(source).toContain("crypto.subtle.verify")
    expect(source).toContain("crypto.subtle.decrypt")
    expect(source).toContain("MAX_FRAME_AGE_MS")
    expect(source).toContain("rememberMessage")
  })

  it("interoperates with relay frames and seals valid device commands", async () => {
    const [relaySigning, relayEncryption, deviceSigning, deviceEncryption] = await Promise.all([
      generateSigningKeyPair(),
      generateEncryptionKeyPair(),
      generateSigningKeyPair(),
      generateEncryptionKeyPair(),
    ])
    const deviceId = await signingKeyFingerprint(deviceSigning.publicKey)
    const identity = {
      deviceId,
      signingPrivateKey: deviceSigning.privateKey,
      encryptionPrivateKey: deviceEncryption.privateKey,
      relaySigningKey: relaySigning.publicKey,
      relayEncryptionKey: relayEncryption.publicKey,
    }
    const frame = await sealJsonPayload({
      type: "notification.show",
      title: "Private title",
      body: "Private body",
      tag: "permission-1",
      actions: [],
      data: { workspaceRelayId: "relay-1", sessionId: "session-1" },
    }, {
      channel: "push",
      sender: "relay-1",
      recipient: deviceId,
      messageId: crypto.randomUUID(),
      issuedAt: Date.now(),
      senderSigningPrivateKey: relaySigning.privateKey,
      senderEncryptionPrivateKey: relayEncryption.privateKey,
      recipientEncryptionPublicKey: deviceEncryption.publicKey,
    })
    const worker = workerCrypto()

    await expect(worker.verifyAndOpen(frame, identity)).resolves.toMatchObject({ title: "Private title" })
    const tamperedCiphertext = Buffer.from(frame.ciphertext, "base64url")
    tamperedCiphertext[0] ^= 1
    await expect(worker.verifyAndOpen({ ...frame, ciphertext: tamperedCiphertext.toString("base64url") }, identity)).rejects.toThrow()

    const command = { type: "permission.reply", requestId: "request-1", sessionId: "session-1", permissionId: "permission-1", response: "once", replyDialect: "v2" }
    const sealed = await worker.sealCommand(command, identity, "relay-1")
    await expect(openJsonPayload(sealed as never, {
      recipient: "relay-1",
      recipientEncryptionPrivateKey: relayEncryption.privateKey,
      senderEncryptionPublicKey: deviceEncryption.publicKey,
      senderSigningPublicKey: deviceSigning.publicKey,
    })).resolves.toEqual(command)
  })
})
