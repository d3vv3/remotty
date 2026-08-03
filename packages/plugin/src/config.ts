import { isSecureBrokerUrl, type EcPublicJwk } from "@remotty/protocol"
import { randomUUID } from "node:crypto"
import { mkdir, open, readFile, rename, rm, stat, utimes } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

export type InviteRecord = {
  id: string
  secretHash: string
  createdAt: string
  expiresAt: string
  usedAt?: string
}

export type DeviceRecord = {
  id: string
  name: string
  signingPublicKey: EcPublicJwk
  encryptionPublicKey: EcPublicJwk
  enrolledAt: string
  revokedAt?: string
  recentMessages: Array<{ id: string; issuedAt: number }>
}

export type RelayConfig = {
  version: 2
  brokerUrl: string
  roomToken: string
  name: string
  authorityId: string
  relaySigningPublicKey: EcPublicJwk
  relaySigningPrivateKey: JsonWebKey
  relayEncryptionPublicKey: EcPublicJwk
  relayEncryptionPrivateKey: JsonWebKey
  invites: InviteRecord[]
  devices: DeviceRecord[]
}

export type LegacyConfigMarker = {
  version: "legacy"
  path: string
  brokerUrl: string
  name: string
}

export type ConfigState = RelayConfig | LegacyConfigMarker | undefined

export const configPath = () =>
  join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "remotty", "config.json")

const legacyConfigPath = () =>
  join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "opencode-relay", "config.json")

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isString = (value: unknown): value is string => typeof value === "string"

const isPublicJwk = (value: unknown): value is EcPublicJwk =>
  isObject(value) &&
  value.kty === "EC" &&
  value.crv === "P-256" &&
  isString(value.x) &&
  isString(value.y)

const isPrivateJwk = (value: unknown): value is JsonWebKey =>
  isObject(value) && isString(value.d) && isPublicJwk(value)

const isInvite = (value: unknown): value is InviteRecord =>
  isObject(value) &&
  isString(value.id) &&
  isString(value.secretHash) &&
  isString(value.createdAt) &&
  isString(value.expiresAt) &&
  (value.usedAt === undefined || isString(value.usedAt))

const isDevice = (value: unknown): value is DeviceRecord =>
  isObject(value) &&
  isString(value.id) &&
  isString(value.name) &&
  isPublicJwk(value.signingPublicKey) &&
  isPublicJwk(value.encryptionPublicKey) &&
  isString(value.enrolledAt) &&
  (value.revokedAt === undefined || isString(value.revokedAt)) &&
  Array.isArray(value.recentMessages) &&
  value.recentMessages.every((message) =>
    isObject(message) && isString(message.id) && typeof message.issuedAt === "number" && Number.isFinite(message.issuedAt),
  )

const isLegacyConfig = (value: unknown): value is { brokerUrl: string; code: string; name: string } =>
  isObject(value) && value.version === undefined && isString(value.brokerUrl) && isString(value.code) && isString(value.name)

export function parseConfig(value: unknown, path = configPath()): RelayConfig | LegacyConfigMarker {
  if (isLegacyConfig(value)) return { version: "legacy", path, brokerUrl: value.brokerUrl, name: value.name }
  if (!isObject(value) || value.version !== 2) {
    throw new Error(`Unsupported relay config at ${path}; run 'remotty pair' to create a v2 config`)
  }
  if (
    !isString(value.brokerUrl) ||
    !isSecureBrokerUrl(value.brokerUrl) ||
    !isString(value.roomToken) ||
    !isString(value.name) ||
    !isString(value.authorityId) ||
    value.roomToken !== value.authorityId ||
    !isPublicJwk(value.relaySigningPublicKey) ||
    !isPrivateJwk(value.relaySigningPrivateKey) ||
    !isPublicJwk(value.relayEncryptionPublicKey) ||
    !isPrivateJwk(value.relayEncryptionPrivateKey) ||
    !Array.isArray(value.invites) ||
    !value.invites.every(isInvite) ||
    !Array.isArray(value.devices) ||
    !value.devices.every(isDevice)
  ) {
    throw new Error(`Invalid v2 relay config at ${path}`)
  }
  return value as RelayConfig
}

async function readAt(path: string): Promise<RelayConfig | LegacyConfigMarker | undefined> {
  try {
    return parseConfig(JSON.parse(await readFile(path, "utf8")), path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
}

export async function readConfig(): Promise<ConfigState> {
  return (await readAt(configPath())) ?? (await readAt(legacyConfigPath()))
}

export async function writeConfig(config: RelayConfig): Promise<void> {
  parseConfig(config)
  const path = configPath()
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(temporaryPath, "wx", 0o600)
    await handle.writeFile(`${JSON.stringify(config, null, 2)}\n`)
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(temporaryPath, path)
    const directory = await open(dirname(path), "r")
    try {
      await directory.sync()
    } finally {
      await directory.close()
    }
  } catch (error) {
    await handle?.close().catch(() => undefined)
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
}

let configTransaction = Promise.resolve()

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))

async function withConfigFileLock<T>(operation: (assertOwned: () => Promise<void>) => Promise<T>): Promise<T> {
  const lockPath = `${configPath()}.lock`
  const ownerPath = join(lockPath, "owner")
  const owner = `${process.pid}:${randomUUID()}`
  await mkdir(dirname(lockPath), { recursive: true, mode: 0o700 })
  const deadline = Date.now() + 10_000
  while (true) {
    try {
      await mkdir(lockPath, { mode: 0o700 })
      const ownerFile = await open(ownerPath, "wx", 0o600)
      await ownerFile.writeFile(owner)
      await ownerFile.close()
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
      const ownerValue = await readFile(ownerPath, "utf8").catch(() => "")
      const ownerPid = Number(ownerValue.split(":", 1)[0])
      const ownerAlive = Number.isInteger(ownerPid) && ownerPid > 0 && (() => {
        try {
          process.kill(ownerPid, 0)
          return true
        } catch {
          return false
        }
      })()
      const age = Date.now() - await stat(ownerPath).then(
        (value) => value.mtimeMs,
        () => stat(lockPath).then((value) => value.mtimeMs, () => Date.now()),
      )
      if (age > 30_000 && !ownerAlive) await rm(lockPath, { recursive: true, force: true })
      else if (Date.now() >= deadline) throw new Error("Timed out waiting for relay config lock")
      else await sleep(25)
    }
  }
  const assertOwned = async () => {
    const current = await readFile(ownerPath, "utf8").catch(() => "")
    if (current !== owner) throw new Error("Relay config lock ownership was lost")
  }
  const heartbeat = setInterval(() => {
    const now = new Date()
    void utimes(ownerPath, now, now).catch(() => undefined)
  }, 5_000)
  try {
    return await operation(assertOwned)
  } finally {
    clearInterval(heartbeat)
    if (await readFile(ownerPath, "utf8").catch(() => "") === owner) {
      await rm(lockPath, { recursive: true, force: true })
    }
  }
}

export function updateConfig(update: (current: ConfigState) => RelayConfig | Promise<RelayConfig>): Promise<RelayConfig> {
  const transaction = configTransaction.then(() => withConfigFileLock(async (assertOwned) => {
    const next = await update(await readConfig())
    await assertOwned()
    await writeConfig(next)
    return next
  }))
  configTransaction = transaction.then(
    () => undefined,
    () => undefined,
  )
  return transaction
}
