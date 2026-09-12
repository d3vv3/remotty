import { readFile } from "node:fs/promises"
import { runInNewContext } from "node:vm"
import { IDBFactory, IDBKeyRange } from "fake-indexeddb"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { imageDigest, type AttachmentDescriptor } from "@remotty/protocol"

let store: typeof import("../src/infrastructure/storage/attachmentStore")
const bytes = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8sMCIgYGBiYGBgYGBAQAWAAHGcnGOMgAAAABJRU5ErkJggg==", "base64"))
const address = { sessionId: "session", messageId: "message", attachmentId: "image" }
let descriptor: AttachmentDescriptor
const opened: IDBDatabase[] = []
beforeEach(async () => {
  for (const db of opened.splice(0)) db.close()
  vi.resetModules()
  vi.stubGlobal("indexedDB", new IDBFactory())
  vi.stubGlobal("IDBKeyRange", IDBKeyRange)
  vi.stubGlobal("localStorage", { getItem: () => null, removeItem: vi.fn() })
  store = await import("../src/infrastructure/storage/attachmentStore")
  descriptor = { id: "image", storage: "remotty-attachment-v1", mime: "image/png", byteLength: bytes.length, digest: await imageDigest(bytes) }
})
const done = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error) })
const get = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
async function oldDatabase() {
  const request = indexedDB.open("remotty-e2ee-v2", 2)
  request.onupgradeneeded = () => { for (const name of ["identities", "meta", "messages", "cache"]) request.result.createObjectStore(name, { keyPath: "key" }) }
  const db = await get(request)
  opened.push(db)
  return db
}
async function worker() {
  const source = await readFile(new URL("../public/notification-sw.js", import.meta.url), "utf8")
  return runInNewContext(`${source}\n;({openDatabase})`, {
    indexedDB, IDBKeyRange, TextEncoder, TextDecoder, setTimeout, clearTimeout, self: { addEventListener: vi.fn() },
  }) as { openDatabase: () => Promise<IDBDatabase> }
}
describe("separate attachment database", () => {
  it("closes on version change and resets a rejected open for retry", async () => {
    const db = await store.openAttachmentDatabase()
    const upgraded = await get(indexedDB.open(store.ATTACHMENT_DB_NAME, 2))
    expect(upgraded.version).toBe(2)
    upgraded.close()
    await expect(store.openAttachmentDatabase()).rejects.toThrow("unavailable")
    await get(indexedDB.deleteDatabase(store.ATTACHMENT_DB_NAME))
    const retry = await store.openAttachmentDatabase()
    opened.push(db, retry)
    expect(retry.version).toBe(1)
  })
  it("still deletes identity keys when cache opening fails", async () => {
    const old = await oldDatabase()
    const tx = old.transaction("identities", "readwrite")
    tx.objectStore("identities").put({ key: "owner", signingPrivateKey: "secret" })
    await done(tx)
    const incompatible = await get(indexedDB.open(store.ATTACHMENT_DB_NAME, 2))
    opened.push(incompatible)
    const device = await import("../src/infrastructure/storage/deviceStore")
    await device.deleteIdentity({ key: "owner" } as Parameters<typeof device.deleteIdentity>[0])
    expect(await get(old.transaction("identities").objectStore("identities").get("owner"))).toBeUndefined()
  })
  it.each(["worker-first", "browser-first"])("creates the separate cache alongside an open v2 tab and notification worker: %s", async (order) => {
    const old = await oldDatabase() // Deliberately no versionchange handler.
    const existing = old.transaction(["identities", "cache"], "readwrite")
    existing.objectStore("identities").put({ key: "owner", signingPrivateKey: "existing-key" })
    existing.objectStore("cache").put({ key: "owner:session", value: "existing-session" })
    await done(existing)
    const w = await worker()
    if (order === "worker-first") opened.push(await w.openDatabase())
    opened.push(await store.openAttachmentDatabase())
    if (order === "browser-first") opened.push(await w.openDatabase())
    const workerDb = await w.openDatabase()
    opened.push(workerDb)
    expect(workerDb.version).toBe(2)
    expect(Array.from(workerDb.objectStoreNames)).toEqual(["cache", "identities", "messages", "meta"])
    expect(old.objectStoreNames.contains("attachments")).toBe(false)
    expect(await get(workerDb.transaction("identities").objectStore("identities").get("owner"))).toEqual({ key: "owner", signingPrivateKey: "existing-key" })
    expect(await get(old.transaction("cache").objectStore("cache").get("owner:session"))).toEqual({ key: "owner:session", value: "existing-session" })
    await store.saveCachedAttachment({ key: "owner" }, "workspace", address, descriptor, bytes)
    expect(await store.loadCachedAttachment({ key: "owner" }, "workspace", address, descriptor)).toEqual(bytes)
    expect(await store.loadCachedAttachment({ key: "other" }, "workspace", address, descriptor)).toBeUndefined()
    expect(await store.loadCachedAttachment({ key: "owner" }, "other", address, descriptor)).toBeUndefined()
  })
  it("prunes by scoped metadata without loading blobs and retains other identities", async () => {
    const db = await store.openAttachmentDatabase()
    opened.push(db)
    const tx = db.transaction(["metadata", "bytes"], "readwrite")
    for (let index = 0; index < 201; index++) {
      tx.objectStore("metadata").put({ key: `old-${index}`, identityKey: "owner", byteLength: 1, touchedAt: index })
      tx.objectStore("bytes").put(bytes, `old-${index}`)
    }
    tx.objectStore("metadata").put({ key: "other", identityKey: "other", byteLength: 1, touchedAt: 0 })
    tx.objectStore("bytes").put(bytes, "other")
    await done(tx)
    await store.saveCachedAttachment({ key: "owner" }, "workspace", address, descriptor, bytes)
    const read = db.transaction(["metadata", "bytes"], "readonly")
    expect(await get(read.objectStore("metadata").index("identityKey").count("owner"))).toBe(200)
    expect(await get(db.transaction("bytes").objectStore("bytes").get("old-0"))).toBeUndefined()
    expect(await get(db.transaction("bytes").objectStore("bytes").get("other"))).toEqual(bytes)
    const large = db.transaction("metadata", "readwrite")
    large.objectStore("metadata").put({ key: "large", identityKey: "owner", byteLength: 50 * 1024 * 1024, touchedAt: 1 })
    await done(large)
    await store.saveCachedAttachment({ key: "owner" }, "workspace", address, descriptor, bytes)
    expect(await get(db.transaction("metadata").objectStore("metadata").get("large"))).toBeUndefined()
  })
  it("browser identity deletion wipes keys and cache, preventing late resurrection", async () => {
    const old = await oldDatabase()
    const tx = old.transaction("identities", "readwrite")
    tx.objectStore("identities").put({ key: "owner", signingPrivateKey: "secret" })
    await done(tx)
    await store.saveCachedAttachment({ key: "owner" }, "workspace", address, descriptor, bytes)
    const device = await import("../src/infrastructure/storage/deviceStore")
    await device.deleteIdentity({ key: "owner" } as Parameters<typeof device.deleteIdentity>[0])
    expect(await get(old.transaction("identities").objectStore("identities").get("owner"))).toBeUndefined()
    const cache = await store.openAttachmentDatabase()
    opened.push(cache)
    expect(await get(cache.transaction("metadata").objectStore("metadata").count())).toBe(0)
    expect(await get(cache.transaction("bytes").objectStore("bytes").count())).toBe(0)
    await store.saveCachedAttachment({ key: "owner" }, "workspace", address, descriptor, bytes)
    expect(await store.loadCachedAttachment({ key: "owner" }, "workspace", address, descriptor)).toBeUndefined()
  })
})
