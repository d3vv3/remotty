import { once } from "node:events"
import { createServer } from "node:http"
import { spawn } from "node:child_process"
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
const nextMessage = (socket: WebSocket) => Promise.race([
  once(socket, "message"),
  new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Timed out waiting for broker message")), 4_000)),
])

describe("production broker interruption", () => {
  it("authenticates, routes opaque frames, and accepts a reconnecting client", async () => {
    const port = await reservePort()
    const child = spawn(process.execPath, [resolve("node_modules/tsx/dist/cli.mjs"), "src/server.ts"], {
      cwd: resolve("."), env: { ...process.env, PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"],
    })
    const output: Buffer[] = []
    child.stdout.on("data", (data) => output.push(data))
    child.stderr.on("data", (data) => output.push(data))
    try {
      await new Promise<void>((resolveReady, reject) => {
        const timer = setTimeout(() => reject(new Error(Buffer.concat(output).toString())), 10_000)
        child.stdout.on("data", (data) => { if (data.toString().includes("remotty broker listening")) { clearTimeout(timer); resolveReady() } })
        child.on("exit", () => { clearTimeout(timer); reject(new Error(Buffer.concat(output).toString())) })
      })
      const relayKeys = await generateSigningKeyPair()
      const relayEncryption = await generateEncryptionKeyPair()
      const roomToken = await signingKeyFingerprint(relayKeys.publicKey)
      const clientKeys = await generateSigningKeyPair()
      const clientEncryption = await generateEncryptionKeyPair()
      const clientId = await signingKeyFingerprint(clientKeys.publicKey)
      const connect = async (role: "relay" | "client", id: string, keys: Awaited<ReturnType<typeof generateSigningKeyPair>>) => {
        const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?role=${role}`, ["remotty", roomToken])
        await once(socket, "open")
        const [challenge] = await nextMessage(socket)
        const nonce = JSON.parse(challenge.toString()).nonce
        const signature = await signCanonicalJson(transportProofPayload(role, id, roomToken, nonce), keys.privateKey)
        socket.send(JSON.stringify({ type: "transport.hello", version: 2, role, ...(role === "relay" ? { relayId: id } : { deviceId: id }), publicKey: keys.publicKey, signature }))
        return socket
      }
      const relay = await connect("relay", roomToken, relayKeys)
      const [ready] = await nextMessage(relay)
      expect(JSON.parse(ready.toString())).toMatchObject({ type: "broker.ready" })
      const client = await connect("client", clientId, clientKeys)
      await nextMessage(client)
      const frame = await sealJsonPayload({ test: "routed" }, {
        channel: "data", sender: clientId, recipient: roomToken, messageId: crypto.randomUUID(), issuedAt: Date.now(),
        senderSigningPrivateKey: clientKeys.privateKey, senderEncryptionPrivateKey: clientEncryption.privateKey,
        recipientEncryptionPublicKey: relayEncryption.publicKey,
      })
      client.send(JSON.stringify(frame))
      const [routed] = await nextMessage(relay)
      expect(JSON.parse(routed.toString())).toMatchObject({ recipient: roomToken })
      client.terminate()
      await once(client, "close")
      const reconnected = await connect("client", clientId, clientKeys)
      await nextMessage(reconnected)
      reconnected.send(JSON.stringify(frame))
      const [routedAgain] = await nextMessage(relay)
      expect(JSON.parse(routedAgain.toString())).toMatchObject({ recipient: roomToken })
      relay.close(); reconnected.close()
    } finally {
      child.kill("SIGKILL")
      await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 1_000))])
    }
  }, 20_000)
})
