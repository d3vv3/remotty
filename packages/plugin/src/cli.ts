#!/usr/bin/env node
import { randomBytes } from "node:crypto"
import { hostname } from "node:os"
import { configPath, readConfig, writeConfig } from "./config.js"

const pairingCode = () => randomBytes(32).toString("base64url")

const [command = "help", ...args] = process.argv.slice(2)
const option = (name: string) => {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}

if (command === "pair") {
  const brokerUrl = option("--broker") ?? process.env.REMOTTY_URL ?? process.env.OPENCODE_RELAY_URL ?? "ws://localhost:8787/ws"
  const code = pairingCode()
  await writeConfig({ brokerUrl, code, name: option("--name") ?? process.env.REMOTTY_NAME ?? hostname() })
  console.log(`Pairing key: ${code}`)
  console.log(`Broker: ${brokerUrl}`)
  console.log(`Saved: ${configPath()}`)
} else if (command === "status") {
  const config = await readConfig()
  console.log(config ? JSON.stringify({ ...config, path: configPath() }, null, 2) : "Not paired")
} else {
  console.log("Usage: remotty <pair|status> [--broker wss://host/ws] [--name workstation]")
}
