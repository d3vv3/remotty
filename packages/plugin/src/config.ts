import { mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

export type RelayConfig = {
  brokerUrl: string
  code: string
  name: string
}

export const configPath = () =>
  join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "remotty", "config.json")

const legacyConfigPath = () =>
  join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "opencode-relay", "config.json")

export async function readConfig(): Promise<RelayConfig | undefined> {
  try {
    return JSON.parse(await readFile(configPath(), "utf8")) as RelayConfig
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      try {
        const config = JSON.parse(await readFile(legacyConfigPath(), "utf8")) as RelayConfig
        await writeConfig(config)
        return config
      } catch (legacyError) {
        if ((legacyError as NodeJS.ErrnoException).code === "ENOENT") return undefined
        throw legacyError
      }
    }
    throw error
  }
}

export async function writeConfig(config: RelayConfig): Promise<void> {
  const path = configPath()
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
}
