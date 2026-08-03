import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

describe("broker source boundary", () => {
  it("does not use plaintext protocol schemas or fields", async () => {
    const source = await Promise.all(["server.ts", "rooms.ts"].map((file) =>
      readFile(fileURLToPath(new URL(`../src/${file}`, import.meta.url)), "utf8"),
    )).then((files) => files.join("\n"))
    for (const forbidden of [
      "clientCommandSchema",
      "relayMessageSchema",
      "combinedSnapshot",
      "sessionId",
      "permission.asked",
      "question.asked",
      "rpc.result",
      "relay.snapshot",
    ]) {
      expect(source).not.toContain(forbidden)
    }
  })
})
