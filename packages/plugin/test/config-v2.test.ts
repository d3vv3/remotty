import { generateEncryptionKeyPair, generateSigningKeyPair } from "@remotty/protocol"
import { mkdtemp, readFile, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { createInvitation, deviceRows, inviteRelay, pairRelay, revokeDevice, statusView } from "../src/cli-core"
import { configPath, parseConfig, readConfig, updateConfig, writeConfig, type RelayConfig } from "../src/config"

const originalConfigHome = process.env.XDG_CONFIG_HOME

afterEach(() => {
  if (originalConfigHome === undefined) delete process.env.XDG_CONFIG_HOME
  else process.env.XDG_CONFIG_HOME = originalConfigHome
})

async function v2Config(): Promise<RelayConfig> {
  const [signing, encryption] = await Promise.all([generateSigningKeyPair(), generateEncryptionKeyPair()])
  return {
    version: 2,
    brokerUrl: "wss://broker.example/ws",
    roomToken: "r".repeat(43),
    name: "relay",
    authorityId: "r".repeat(43),
    relaySigningPublicKey: signing.publicKey,
    relaySigningPrivateKey: signing.privateKey,
    relayEncryptionPublicKey: encryption.publicKey,
    relayEncryptionPrivateKey: encryption.privateKey,
    invites: [],
    devices: [],
  }
}

describe("v2 relay configuration", () => {
  it("detects legacy configuration without returning its secret", () => {
    expect(parseConfig({ brokerUrl: "wss://broker", code: "raw-secret", name: "old" }, "/legacy/config.json")).toEqual({
      version: "legacy",
      path: "/legacy/config.json",
      brokerUrl: "wss://broker",
      name: "old",
    })
  })

  it("stores only the invite secret hash in a mode 0600 config", async () => {
    process.env.XDG_CONFIG_HOME = await mkdtemp(join(tmpdir(), "remotty-config-"))
    const config = await v2Config()
    const invitation = createInvitation(new Date("2026-08-03T10:00:00.000Z"))
    config.invites.push(invitation.record)
    await writeConfig(config)

    const contents = await readFile(configPath(), "utf8")
    expect(contents).toContain(invitation.record.secretHash)
    expect(contents).not.toContain(invitation.secret)
    expect((await stat(configPath())).mode & 0o777).toBe(0o600)
  })

  it("expires invitations after ten minutes", () => {
    const invitation = createInvitation(new Date("2026-08-03T10:00:00.000Z"))
    expect(invitation.record.expiresAt).toBe("2026-08-03T10:10:00.000Z")
  })

  it("preserves authority and relay keys when pair is run on v2", async () => {
    const existing = await v2Config()
    const result = await pairRelay(existing, { brokerUrl: "wss://new.example/ws", name: "renamed" })

    expect(result.config.authorityId).toBe(existing.authorityId)
    expect(result.config.relaySigningPrivateKey).toEqual(existing.relaySigningPrivateKey)
    expect(result.config.relayEncryptionPrivateKey).toEqual(existing.relayEncryptionPrivateKey)
    expect(result.config.invites).toHaveLength(1)
    expect(result.config.brokerUrl).toBe("wss://new.example/ws")
  })

  it("uses the relay signing fingerprint as the public room identifier", async () => {
    const result = await pairRelay(undefined, { brokerUrl: "wss://broker.example/ws", name: "relay" })
    expect(result.config.roomToken).toBe(result.config.authorityId)
  })

  it("serializes config updates so concurrent invitations are not lost", async () => {
    process.env.XDG_CONFIG_HOME = await mkdtemp(join(tmpdir(), "remotty-config-"))
    await writeConfig(await v2Config())
    const addInvite = () =>
      updateConfig(async (current) => {
        if (current?.version !== 2) throw new Error("Expected v2 config")
        await new Promise((resolve) => setTimeout(resolve, 5))
        return inviteRelay(current).config
      })

    await Promise.all([addInvite(), addInvite()])
    const saved = await readConfig()
    expect(saved?.version).toBe(2)
    if (saved?.version === 2) expect(saved.invites).toHaveLength(2)
  })

  it("revokes known devices and rejects unknown ids", async () => {
    const config = await v2Config()
    config.devices.push({
      id: "device-1",
      name: "phone",
      signingPublicKey: config.relaySigningPublicKey,
      encryptionPublicKey: config.relayEncryptionPublicKey,
      enrolledAt: "2026-08-01T10:00:00.000Z",
      recentMessages: [],
    })

    const revoked = revokeDevice(config, "device-1", new Date("2026-08-03T10:00:00.000Z"))
    expect(revoked.devices[0]?.revokedAt).toBe("2026-08-03T10:00:00.000Z")
    expect(deviceRows(revoked)).toEqual([
      {
        id: "device-1",
        name: "phone",
        enrolledAt: "2026-08-01T10:00:00.000Z",
        revokedAt: "2026-08-03T10:00:00.000Z",
      },
    ])
    expect(() => revokeDevice(config, "missing")).toThrow("Unknown device: missing")
  })

  it("creates a secret-free status summary with active and pending counts", async () => {
    const config = await v2Config()
    config.invites.push(createInvitation(new Date("2026-08-03T09:55:00.000Z")).record)
    config.invites.push(createInvitation(new Date("2026-08-03T09:00:00.000Z")).record)

    const status = statusView(config, new Date("2026-08-03T10:00:00.000Z"))
    expect(status).toMatchObject({ version: 2, broker: config.brokerUrl, authorityId: config.authorityId, pendingInvites: 1 })
    expect(status.authorityId).toBe(config.roomToken)
    expect(JSON.stringify(status)).not.toContain("PrivateKey")
  })
})
