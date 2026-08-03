import {
  base64urlEncode,
  generateEncryptionKeyPair,
  generateSigningKeyPair,
  signingKeyFingerprint,
  type PairingBundle,
} from "@remotty/protocol"
import { createHash, randomBytes } from "node:crypto"
import { hostname } from "node:os"
import clipboard from "clipboardy"
import QRCode from "qrcode"
import {
  configPath,
  readConfig,
  updateConfig,
  type ConfigState,
  type InviteRecord,
  type LegacyConfigMarker,
  type RelayConfig,
} from "./config.js"
import { DEFAULT_BROKER_URL, pairingToken, pairingUrl } from "./pairing.js"

export const INVITE_TTL_MS = 10 * 60 * 1_000

export type Invitation = {
  record: InviteRecord
  secret: string
}

export type PairOptions = {
  brokerUrl?: string
  name?: string
  now?: Date
}

const randomToken = () => base64urlEncode(randomBytes(32))

export function createInvitation(now = new Date()): Invitation {
  const secret = randomToken()
  return {
    secret,
    record: {
      id: base64urlEncode(randomBytes(16)),
      secretHash: createHash("sha256").update(secret).digest("base64url"),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + INVITE_TTL_MS).toISOString(),
    },
  }
}

export async function pairRelay(current: ConfigState, options: PairOptions = {}) {
  const invitation = createInvitation(options.now)
  if (current?.version === 2) {
    return {
      config: {
        ...current,
        brokerUrl: options.brokerUrl ?? current.brokerUrl,
        name: options.name ?? current.name,
        invites: [...current.invites, invitation.record],
      },
      invitation,
    }
  }

  const [signing, encryption] = await Promise.all([generateSigningKeyPair(), generateEncryptionKeyPair()])
  const authorityId = await signingKeyFingerprint(signing.publicKey)
  const config: RelayConfig = {
    version: 2,
    brokerUrl: options.brokerUrl ?? (current?.version === "legacy" ? current.brokerUrl : DEFAULT_BROKER_URL),
    roomToken: authorityId,
    name: options.name ?? (current?.version === "legacy" ? current.name : hostname()),
    authorityId,
    relaySigningPublicKey: signing.publicKey,
    relaySigningPrivateKey: signing.privateKey,
    relayEncryptionPublicKey: encryption.publicKey,
    relayEncryptionPrivateKey: encryption.privateKey,
    invites: [invitation.record],
    devices: [],
  }
  return { config, invitation }
}

export function inviteRelay(config: RelayConfig, now = new Date()) {
  const invitation = createInvitation(now)
  return { config: { ...config, invites: [...config.invites, invitation.record] }, invitation }
}

export function revokeDevice(config: RelayConfig, id: string, now = new Date()): RelayConfig {
  const device = config.devices.find((candidate) => candidate.id === id)
  if (!device) throw new Error(`Unknown device: ${id}`)
  if (device.revokedAt) return config
  return {
    ...config,
    devices: config.devices.map((candidate) =>
      candidate.id === id ? { ...candidate, revokedAt: now.toISOString() } : candidate,
    ),
  }
}

export function statusView(config: RelayConfig, now = new Date()) {
  const timestamp = now.getTime()
  return {
    version: config.version,
    broker: config.brokerUrl,
    name: config.name,
    authorityId: config.authorityId,
    activeDevices: config.devices.filter((device) => !device.revokedAt).length,
    pendingInvites: config.invites.filter(
      (invite) => !invite.usedAt && Date.parse(invite.expiresAt) > timestamp,
    ).length,
    path: configPath(),
  }
}

export const deviceRows = (config: RelayConfig) =>
  config.devices.map(({ id, name, enrolledAt, revokedAt }) => ({ id, name, enrolledAt, revokedAt }))

export function pairingBundle(config: RelayConfig, invitation: Invitation): PairingBundle {
  return {
    version: 2,
    brokerUrl: config.brokerUrl,
    roomToken: config.roomToken,
    inviteId: invitation.record.id,
    inviteSecret: invitation.secret,
    relayId: config.authorityId,
    relaySigningKey: config.relaySigningPublicKey,
    relayEncryptionKey: config.relayEncryptionPublicKey,
  }
}

const legacyMessage = (legacy: LegacyConfigMarker) =>
  `Legacy relay config found at ${legacy.path}; run 'remotty pair' to replace it with v2`

const requireV2 = (config: ConfigState): RelayConfig => {
  if (!config) throw new Error("Not paired; run 'remotty pair' first")
  if (config.version === "legacy") throw new Error(legacyMessage(config))
  return config
}

export const terminalHyperlink = (url: string, interactive = process.stdout.isTTY, label = url) =>
  interactive ? `\u001B]8;;${url}\u0007${label}\u001B]8;;\u0007` : url

export const terminalQrCode = (value: string) =>
  QRCode.toString(value, { type: "terminal", small: true, errorCorrectionLevel: "Q" })

export const copyPairingToken = async (
  token: string,
  write: (value: string) => Promise<void> = (value) => clipboard.write(value),
) => {
  try {
    await write(token)
    return true
  } catch {
    return false
  }
}

const printInvitation = async (config: RelayConfig, invitation: Invitation, appUrl?: string) => {
  const bundle = pairingBundle(config, invitation)
  const token = pairingToken(bundle)
  const url = pairingUrl(bundle, appUrl)
  const copied = await copyPairingToken(token)
  console.log(`Invite expires: ${invitation.record.expiresAt}`)
  if (!copied) console.log(`Token: ${token}`)
  console.log(`Open: ${terminalHyperlink(url, process.stdout.isTTY, "pairing page")}`)
  console.log(copied ? "Copied invite token to clipboard." : "Clipboard unavailable; copy the token or open the link.")
  console.log(await terminalQrCode(url))
  console.log(`Saved: ${configPath()}`)
}

export async function runCli(argv = process.argv.slice(2)): Promise<void> {
  const [command = "help", ...args] = argv
  const option = (name: string) => {
    const index = args.indexOf(name)
    return index === -1 ? undefined : args[index + 1]
  }

  if (command === "pair") {
    let result: Awaited<ReturnType<typeof pairRelay>> | undefined
    const config = await updateConfig(async (current) => {
      result = await pairRelay(current, {
        brokerUrl: option("--broker") ?? process.env.REMOTTY_URL ?? process.env.OPENCODE_RELAY_URL,
        name: option("--name") ?? process.env.REMOTTY_NAME,
      })
      return result.config
    })
    await printInvitation(config, result!.invitation, option("--app") ?? process.env.REMOTTY_APP_URL)
    return
  }

  if (command === "invite") {
    let invitation: Invitation | undefined
    const config = await updateConfig((current) => {
      const result = inviteRelay(requireV2(current))
      invitation = result.invitation
      return result.config
    })
    await printInvitation(config, invitation!, option("--app") ?? process.env.REMOTTY_APP_URL)
    return
  }

  if (command === "devices") {
    console.log(JSON.stringify(deviceRows(requireV2(await readConfig())), null, 2))
    return
  }

  if (command === "revoke") {
    const id = args[0]
    if (!id) throw new Error("Usage: remotty revoke <id>")
    await updateConfig((current) => revokeDevice(requireV2(current), id))
    console.log(`Revoked device: ${id}`)
    return
  }

  if (command === "status") {
    const config = await readConfig()
    if (!config) console.log("Not paired")
    else if (config.version === "legacy") console.log(legacyMessage(config))
    else console.log(JSON.stringify(statusView(config), null, 2))
    return
  }

  console.log("Usage: remotty <pair|invite|devices|revoke <id>|status>")
}
