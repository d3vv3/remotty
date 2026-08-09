import { describe, expect, it } from "vitest"
import { canonicalJsonFingerprint, canonicalMessageValue } from "@remotty/protocol"
import { commitManifestForRefresh, commitMessageManifest, emptyMessageCache, messageInventory, migrateMessageCache, replaceCanonicalMessages, stageMessage, verifyDeltaSnapshot, visibleCachedMessages } from "../src/messageCache"

const message = (id: string, text: string, delivery?: string) => ({ info: { id, ...(delivery ? { delivery } : {}) }, parts: [{ type: "text", text }] })
const entry = async (value: ReturnType<typeof message>) => ({ id: value.info.id, fingerprint: await canonicalJsonFingerprint(canonicalMessageValue(value)) })

describe("versioned message cache", () => {
  it("migrates raw arrays and preserves local optimistic records", async () => {
    const cache = await migrateMessageCache([message("local", "phone", "accepted")])
    expect(cache.version).toBe(2)
    expect(visibleCachedMessages(cache).map((item) => item.info.id)).toEqual(["local"])
  })

  it("stages then atomically commits and only deletes after a valid commit", async () => {
    const old = message("old", "old")
    const fresh = message("fresh", "fresh")
    const oldEntry = await entry(old)
    let cache = emptyMessageCache<typeof old>()
    cache = await stageMessage(cache, old, oldEntry.fingerprint)
    cache = commitMessageManifest(cache, { version: 1, scope: { kind: "tail", limit: 80 }, manifest: [oldEntry], upserts: ["old"], chunkCount: 1, snapshotId: "x".repeat(43) })!
    cache = await stageMessage(cache, fresh)
    expect(visibleCachedMessages(cache).map((item) => item.info.id)).toEqual(["old", "fresh"])
    expect(commitMessageManifest(cache, { version: 1, scope: { kind: "tail", limit: 80 }, manifest: [await entry(fresh)], upserts: ["fresh"], chunkCount: 1, snapshotId: "x".repeat(43) })?.canonical.manifest.map((item) => item.id)).toEqual(["fresh"])
  })

  it("advertises verified staged bodies on resume and rejects bad fingerprints", async () => {
    const value = message("staged", "body")
    const cache = await stageMessage(emptyMessageCache<typeof value>(), value)
    expect(messageInventory(cache)).toHaveLength(1)
    await expect(stageMessage(cache, value, "x".repeat(43))).rejects.toThrow("fingerprint")
  })

  it("lets cumulative canonical progress repair staged transport order", async () => {
    const tool = message("tool", "tool")
    const user = message("user", "user")
    let cache = await stageMessage(emptyMessageCache<typeof tool>(), user)
    cache = await stageMessage(cache, tool)
    cache = await stageMessage(cache, user)
    expect(visibleCachedMessages(cache).map((item) => item.info.id)).toEqual(["tool", "user"])
  })

  it("commits a deletion-only zero-upsert manifest after an unchanged one", async () => {
    const first = message("first", "one")
    const second = message("second", "two")
    const firstEntry = await entry(first)
    const secondEntry = await entry(second)
    let cache = await replaceCanonicalMessages(emptyMessageCache<typeof first>(), [first, second])
    const unchanged = { version: 1 as const, scope: { kind: "tail" as const, limit: 80 as const }, manifest: [firstEntry, secondEntry], upserts: [], chunkCount: 0, snapshotId: "x".repeat(43) }
    cache = commitMessageManifest(cache, unchanged)!
    cache = commitMessageManifest(cache, { ...unchanged, manifest: [secondEntry] })!
    expect(visibleCachedMessages(cache).map((item) => item.info.id)).toEqual(["second"])
  })

  it("constructs a durable canonical cache from legacy responses and preserves manifest order", async () => {
    const later = { ...message("later", "later"), info: { id: "later", time: { created: 9 } } }
    const first = { ...message("first", "first"), info: { id: "first" } }
    const cache = await replaceCanonicalMessages(emptyMessageCache<typeof first>(), [later, first])
    expect(cache.canonical.manifest.map((item) => item.id)).toEqual(["later", "first"])
    expect(visibleCachedMessages(cache).map((item) => item.info.id)).toEqual(["later", "first"])
    expect(messageInventory(await migrateMessageCache(cache))).toHaveLength(2)
  })

  it("rejects a manifest whose snapshot id does not bind its canonical manifest", async () => {
    const value = message("one", "body")
    expect(await verifyDeltaSnapshot({ version: 1, scope: { kind: "tail", limit: 80 }, manifest: [await entry(value)], upserts: [], chunkCount: 0, snapshotId: "x".repeat(43) })).toBe(false)
  })

  it("keeps an accepted local prompt for one completed miss, then marks it uncertain", async () => {
    const local = message("phone", "draft", "accepted")
    const remote = message("remote", "body")
    const remoteEntry = await entry(remote)
    const manifest = { version: 1 as const, scope: { kind: "tail" as const, limit: 80 as const }, manifest: [remoteEntry], upserts: [], chunkCount: 0, snapshotId: "x".repeat(43) }
    let cache = await replaceCanonicalMessages(emptyMessageCache<typeof local>(), [remote])
    cache = { ...cache, local: { messages: [local] } }
    cache = commitMessageManifest(cache, manifest)!
    expect(visibleCachedMessages(cache).find((item) => item.info.id === "phone")?.info.delivery).toBe("accepted")
    cache = commitMessageManifest(cache, manifest)!
    expect(visibleCachedMessages(cache).find((item) => item.info.id === "phone")?.info.delivery).toBe("uncertain")
  })

  it("does not reconcile an uncertain repeated prompt against messages known before sending", async () => {
    type PromptMessage = { info: { id: string; role: string; delivery?: string; legacyPrompt?: boolean; knownMessageIds?: string[] }; parts: Array<{ type: string; text: string }> }
    const old: PromptMessage = { info: { id: "old", role: "user" }, parts: [{ type: "text", text: "continue" }] }
    const local: PromptMessage = { info: { id: "local", role: "user", delivery: "uncertain", legacyPrompt: true, knownMessageIds: ["old", "staged"] }, parts: [{ type: "text", text: "continue" }] }
    const oldEntry = await entry(old)
    let cache = await replaceCanonicalMessages(emptyMessageCache<PromptMessage>(), [old])
    cache = { ...cache, local: { messages: [local] } }
    cache = commitMessageManifest(cache, { version: 1, scope: { kind: "tail", limit: 80 }, manifest: [oldEntry], upserts: [], chunkCount: 0, snapshotId: "x".repeat(43) })!
    expect(visibleCachedMessages(cache).map((item) => item.info.id)).toEqual(["old", "local"])

    const staged: PromptMessage = { info: { id: "staged", role: "user" }, parts: [{ type: "text", text: "continue" }] }
    const stagedEntry = await entry(staged)
    cache = await stageMessage(cache, staged)
    cache = commitMessageManifest(cache, { version: 1, scope: { kind: "tail", limit: 80 }, manifest: [oldEntry, stagedEntry], upserts: ["staged"], chunkCount: 1, snapshotId: "x".repeat(43) })!
    expect(visibleCachedMessages(cache).map((item) => item.info.id)).toEqual(["old", "staged", "local"])

    const fresh: PromptMessage = { info: { id: "fresh", role: "user" }, parts: [{ type: "text", text: "continue" }] }
    const freshEntry = await entry(fresh)
    cache = await stageMessage(cache, fresh)
    cache = commitMessageManifest(cache, { version: 1, scope: { kind: "tail", limit: 80 }, manifest: [oldEntry, stagedEntry, freshEntry], upserts: ["fresh"], chunkCount: 1, snapshotId: "x".repeat(43) })!
    expect(visibleCachedMessages(cache).map((item) => item.info.id)).toEqual(["old", "staged", "fresh"])
  })

  it("uses each canonical text match for at most one uncertain retry", async () => {
    type PromptMessage = { info: { id: string; role: string; delivery?: string; legacyPrompt?: boolean; knownMessageIds?: string[] }; parts: Array<{ type: string; text: string }> }
    const canonical: PromptMessage = { info: { id: "canonical", role: "user" }, parts: [{ type: "text", text: "continue" }] }
    const first: PromptMessage = { info: { id: "first", role: "user", delivery: "uncertain", legacyPrompt: true, knownMessageIds: [] }, parts: [{ type: "text", text: "continue" }] }
    const retry: PromptMessage = { info: { id: "retry", role: "user", delivery: "uncertain", legacyPrompt: true, knownMessageIds: [] }, parts: [{ type: "text", text: "continue" }] }
    const canonicalEntry = await entry(canonical)
    let cache = await replaceCanonicalMessages(emptyMessageCache<PromptMessage>(), [canonical])
    cache = { ...cache, local: { messages: [first, retry] } }
    cache = commitMessageManifest(cache, { version: 1, scope: { kind: "tail", limit: 80 }, manifest: [canonicalEntry], upserts: [], chunkCount: 0, snapshotId: "x".repeat(43) })!
    expect(visibleCachedMessages(cache).map((item) => item.info.id)).toEqual(["retry", "canonical"])
  })

  it("keeps failed local prompts before replies that arrived after sending", async () => {
    type PromptMessage = { info: { id: string; role: string; delivery?: string; knownMessageIds?: string[] }; parts: Array<{ type: string; text: string }> }
    const before: PromptMessage = { info: { id: "before", role: "assistant" }, parts: [{ type: "text", text: "before" }] }
    const reply: PromptMessage = { info: { id: "reply", role: "assistant" }, parts: [{ type: "text", text: "reply" }] }
    const first: PromptMessage = { info: { id: "first", role: "user", delivery: "failed", knownMessageIds: ["before"] }, parts: [{ type: "text", text: "first" }] }
    const retry: PromptMessage = { info: { id: "retry", role: "user", delivery: "failed", knownMessageIds: ["before", "first"] }, parts: [{ type: "text", text: "retry" }] }
    const cache = await replaceCanonicalMessages(emptyMessageCache<PromptMessage>(), [before, reply])
    cache.local.messages = [first, retry]
    expect(visibleCachedMessages(cache).map((item) => item.info.id)).toEqual(["before", "first", "retry", "reply"])
  })

  it("places historical failed prompts by timestamp when no baseline was captured", async () => {
    type PromptMessage = { info: { id: string; role: string; delivery?: string; time?: { created: number } }; parts: Array<{ type: string; text: string }> }
    const before: PromptMessage = { info: { id: "before", role: "assistant", time: { created: 1 } }, parts: [{ type: "text", text: "before" }] }
    const failed: PromptMessage = { info: { id: "failed", role: "user", delivery: "failed", time: { created: 2 } }, parts: [{ type: "text", text: "failed" }] }
    const reply: PromptMessage = { info: { id: "reply", role: "assistant", time: { created: 3 } }, parts: [{ type: "text", text: "reply" }] }
    const cache = await replaceCanonicalMessages(emptyMessageCache<PromptMessage>(), [before, reply])
    cache.local.messages = [failed]
    expect(visibleCachedMessages(cache).map((item) => item.info.id)).toEqual(["before", "failed", "reply"])
  })

  it("does not let an older refresh overwrite a newer completed snapshot", async () => {
    const old = message("old", "old")
    const fresh = message("fresh", "fresh")
    let cache = await replaceCanonicalMessages(emptyMessageCache<typeof old>(), [old, fresh])
    const oldEntry = await entry(old)
    const freshEntry = await entry(fresh)
    cache = commitMessageManifest(cache, { version: 1, scope: { kind: "tail", limit: 80 }, manifest: [freshEntry], upserts: [], chunkCount: 0, snapshotId: "x".repeat(43) })!
    const afterStale = commitManifestForRefresh(cache, 1, 2, { version: 1, scope: { kind: "tail", limit: 80 }, manifest: [oldEntry], upserts: [], chunkCount: 0, snapshotId: "x".repeat(43) })
    expect(afterStale).toBeUndefined()
    expect(visibleCachedMessages(cache).map((item) => item.info.id)).toEqual(["fresh"])
  })
})
