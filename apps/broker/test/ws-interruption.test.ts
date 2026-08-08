import { once } from "node:events"
import { createServer } from "node:http"
import { spawn, type ChildProcess } from "node:child_process"
import { resolve } from "node:path"
import { WebSocket } from "ws"
import { generateEncryptionKeyPair, generateSigningKeyPair, sealJsonPayload, signingKeyFingerprint, signCanonicalJson, transportProofPayload } from "@remotty/protocol"
import { describe, expect, it } from "vitest"

const reservePort = async () => {
  const server = createServer()
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const port = (server.address() as { port: number }).port
  server.close()
  await once(server, "close")
  return port
}
const waitFor = <T>(promise: Promise<T>, message: string, timeout = 4_000) => new Promise<T>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(message)), timeout)
  promise.then(
    (value) => { clearTimeout(timer); resolve(value) },
    (error: unknown) => { clearTimeout(timer); reject(error) },
  )
})

const createSocketInbox = (url: string, protocols: string[]) => {
  const socket = new WebSocket(url, protocols)
  const messages: string[] = []
  const waiters: Array<{ resolve: (message: string) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }> = []

  const rejectWaiters = (error: Error) => {
    for (const waiter of waiters.splice(0)) {
      clearTimeout(waiter.timer)
      waiter.reject(error)
    }
  }
  const onMessage = (data: { toString(): string }) => {
    const waiter = waiters.shift()
    if (waiter) {
      clearTimeout(waiter.timer)
      waiter.resolve(data.toString())
    } else {
      messages.push(data.toString())
    }
  }
  const onClose = () => rejectWaiters(new Error("Socket closed before broker message"))
  const onError = (error: Error) => rejectWaiters(error)
  socket.on("message", onMessage)
  socket.on("close", onClose)
  socket.on("error", onError)

  return {
    socket,
    nextMessage: () => {
      const message = messages.shift()
      if (message !== undefined) return Promise.resolve(message)
      return new Promise<string>((resolve, reject) => {
        const waiter = { resolve, reject, timer: setTimeout(() => {
          const index = waiters.indexOf(waiter)
          if (index !== -1) waiters.splice(index, 1)
          reject(new Error("Timed out waiting for broker message"))
        }, 4_000) }
        waiters.push(waiter)
      })
    },
    dispose: () => {
      socket.off("message", onMessage)
      socket.off("close", onClose)
      socket.off("error", onError)
      rejectWaiters(new Error("Socket inbox disposed"))
    },
  }
}

const waitForSocketOpen = (socket: WebSocket) => new Promise<void>((resolve, reject) => {
  const cleanup = () => {
    clearTimeout(timer)
    socket.off("open", onOpen)
    socket.off("close", onClose)
    socket.off("error", onError)
  }
  const onOpen = () => { cleanup(); resolve() }
  const onClose = () => { cleanup(); reject(new Error("Socket closed before opening")) }
  const onError = (error: Error) => { cleanup(); reject(error) }
  const timer = setTimeout(() => { cleanup(); reject(new Error("Timed out opening broker socket")) }, 4_000)
  socket.once("open", onOpen)
  socket.once("close", onClose)
  socket.once("error", onError)
})

const closeSocketInbox = async (inbox: ReturnType<typeof createSocketInbox>) => {
  const { socket } = inbox
  if (socket.readyState !== WebSocket.CLOSED) {
    const closed = waitFor(once(socket, "close").then(() => undefined), "Timed out closing broker socket", 1_000)
    socket.terminate()
    await closed.catch(() => undefined)
  }
  inbox.dispose()
}

const waitForBroker = (child: ChildProcess, output: Buffer[]) => new Promise<void>((resolve, reject) => {
  const cleanup = () => {
    clearTimeout(timer)
    child.stdout?.off("data", onOutput)
    child.off("exit", onExit)
  }
  const fail = () => { cleanup(); reject(new Error(Buffer.concat(output).toString())) }
  const onOutput = (data: Buffer) => {
    if (data.toString().includes("remotty broker listening")) {
      cleanup()
      resolve()
    }
  }
  const onExit = () => fail()
  const timer = setTimeout(fail, 10_000)
  child.stdout?.on("data", onOutput)
  child.once("exit", onExit)
})

const stopBroker = async (child: ChildProcess) => {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = waitFor(once(child, "exit").then(() => undefined), "Timed out stopping broker", 1_000)
  child.kill("SIGKILL")
  await exited.catch(() => undefined)
}

describe("production broker interruption", () => {
  it("authenticates, routes opaque frames, and accepts a reconnecting client", async () => {
    const port = await reservePort()
    const output: Buffer[] = []
    const inboxes: Array<ReturnType<typeof createSocketInbox>> = []
    let child: ChildProcess | undefined
    try {
      child = spawn(process.execPath, [resolve("node_modules/tsx/dist/cli.mjs"), "src/server.ts"], {
        cwd: resolve("."), env: { ...process.env, PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"],
      })
      child.stdout?.on("data", (data) => output.push(data))
      child.stderr?.on("data", (data) => output.push(data))
      await waitForBroker(child, output)
      const relayKeys = await generateSigningKeyPair()
      const relayEncryption = await generateEncryptionKeyPair()
      const roomToken = await signingKeyFingerprint(relayKeys.publicKey)
      const clientKeys = await generateSigningKeyPair()
      const clientEncryption = await generateEncryptionKeyPair()
      const clientId = await signingKeyFingerprint(clientKeys.publicKey)
      const connect = async (role: "relay" | "client", id: string, keys: Awaited<ReturnType<typeof generateSigningKeyPair>>) => {
        const inbox = createSocketInbox(`ws://127.0.0.1:${port}/ws?role=${role}`, ["remotty", roomToken])
        inboxes.push(inbox)
        await waitForSocketOpen(inbox.socket)
        const challenge = await inbox.nextMessage()
        const nonce = JSON.parse(challenge).nonce
        const signature = await signCanonicalJson(transportProofPayload(role, id, roomToken, nonce), keys.privateKey)
        const ready = inbox.nextMessage()
        inbox.socket.send(JSON.stringify({ type: "transport.hello", version: 2, role, ...(role === "relay" ? { relayId: id } : { deviceId: id }), publicKey: keys.publicKey, signature }))
        return { inbox, ready }
      }
      const relay = await connect("relay", roomToken, relayKeys)
      expect(JSON.parse(await relay.ready)).toMatchObject({ type: "broker.ready" })
      const client = await connect("client", clientId, clientKeys)
      expect(JSON.parse(await client.ready)).toMatchObject({ type: "broker.ready" })
      const frame = await sealJsonPayload({ test: "routed" }, {
        channel: "data", sender: clientId, recipient: roomToken, messageId: crypto.randomUUID(), issuedAt: Date.now(),
        senderSigningPrivateKey: clientKeys.privateKey, senderEncryptionPrivateKey: clientEncryption.privateKey,
        recipientEncryptionPublicKey: relayEncryption.publicKey,
      })
      const routed = relay.inbox.nextMessage()
      client.inbox.socket.send(JSON.stringify(frame))
      expect(JSON.parse(await routed)).toMatchObject({ recipient: roomToken })
      await closeSocketInbox(client.inbox)
      const reconnected = await connect("client", clientId, clientKeys)
      expect(JSON.parse(await reconnected.ready)).toMatchObject({ type: "broker.ready" })
      const routedAgain = relay.inbox.nextMessage()
      reconnected.inbox.socket.send(JSON.stringify(frame))
      expect(JSON.parse(await routedAgain)).toMatchObject({ recipient: roomToken })
    } finally {
      try {
        await Promise.all(inboxes.map(closeSocketInbox))
      } finally {
        if (child) await stopBroker(child)
      }
    }
  }, 20_000)
})
