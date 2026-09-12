import { attachmentAddressSchema, attachmentDescriptorSchema, imageDigest, validateImage, type AttachmentAddress, type AttachmentDescriptor } from "@remotty/protocol"

export const ATTACHMENT_DB_NAME = "remotty-attachments-v1"
type Owner = { key: string }
type Metadata = { key: string; identityKey: string; byteLength: number; touchedAt: number }
let opening: Promise<IDBDatabase> | undefined
const result = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error)
})
const complete = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => {
  tx.oncomplete = () => resolve()
  tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("Attachment cache transaction failed"))
  const timeout = setTimeout(() => { try { tx.abort() } catch { /* already completed */ } }, 1500)
  tx.addEventListener("complete", () => clearTimeout(timeout))
  tx.addEventListener("abort", () => clearTimeout(timeout))
})
export function openAttachmentDatabase() {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(ATTACHMENT_DB_NAME, 1)
    let failed = false
    const fail = () => { failed = true; clearTimeout(timeout); opening = undefined; reject(new Error("Attachment cache unavailable")) }
    const timeout = setTimeout(fail, 1500)
    request.onblocked = request.onerror = fail
    request.onupgradeneeded = () => {
      const db = request.result
      const metadata = db.createObjectStore("metadata", { keyPath: "key" })
      metadata.createIndex("identityKey", "identityKey")
      metadata.createIndex("identityTouched", ["identityKey", "touchedAt", "key"])
      db.createObjectStore("bytes")
      // Persistent tombstones serialize identity deletion with writes from other tabs.
      db.createObjectStore("revoked")
    }
    request.onsuccess = () => {
      clearTimeout(timeout)
      const db = request.result
      if (failed) { db.close(); return }
      db.onversionchange = () => { db.close(); opening = undefined }
      resolve(db)
    }
  })
  return opening
}
export const attachmentCacheKey = (identityKey: string, workspace: string, address: AttachmentAddress, descriptor: AttachmentDescriptor) =>
  JSON.stringify([identityKey, workspace, address.sessionId, address.messageId, address.attachmentId, descriptor.digest])
function validateReference(address: AttachmentAddress, descriptor: AttachmentDescriptor) {
  attachmentAddressSchema.parse(address)
  attachmentDescriptorSchema.parse(descriptor)
  if (address.attachmentId !== descriptor.id) throw new Error("Attachment cache reference mismatch")
}
export async function loadCachedAttachment(identity: Owner, workspace: string, address: AttachmentAddress, descriptor: AttachmentDescriptor) {
  validateReference(address, descriptor)
  const db = await openAttachmentDatabase()
  const key = attachmentCacheKey(identity.key, workspace, address, descriptor)
  const tx = db.transaction(["bytes", "revoked"], "readonly")
  const done = complete(tx)
  const [bytes, revoked] = await Promise.all([result(tx.objectStore("bytes").get(key)), result(tx.objectStore("revoked").get(identity.key)), done])
  if (revoked || !bytes) return
  try {
    if (!(bytes instanceof Uint8Array) || !(bytes.buffer instanceof ArrayBuffer) || bytes.length !== descriptor.byteLength || await imageDigest(bytes as Uint8Array<ArrayBuffer>) !== descriptor.digest) throw new Error("Invalid cached image")
    validateImage(bytes, descriptor.mime)
  } catch { return }
  const touch = db.transaction("metadata", "readwrite")
  const store = touch.objectStore("metadata")
  const current = store.get(key)
  current.onsuccess = () => { if (current.result) store.put({ ...current.result, touchedAt: Date.now() }) }
  await complete(touch)
  return bytes as Uint8Array<ArrayBuffer>
}
export async function saveCachedAttachment(identity: Owner, workspace: string, address: AttachmentAddress, descriptor: AttachmentDescriptor, bytes: Uint8Array<ArrayBuffer>) {
  validateReference(address, descriptor)
  validateImage(bytes, descriptor.mime)
  if (bytes.length !== descriptor.byteLength || await imageDigest(bytes) !== descriptor.digest) throw new Error("Invalid attachment cache write")
  const db = await openAttachmentDatabase()
  const tx = db.transaction(["metadata", "bytes", "revoked"], "readwrite")
  const metadata = tx.objectStore("metadata")
  const data = tx.objectStore("bytes")
  const revoked = tx.objectStore("revoked").get(identity.key)
  revoked.onsuccess = () => {
    if (revoked.result) return
    const key = attachmentCacheKey(identity.key, workspace, address, descriptor)
    metadata.put({ key, identityKey: identity.key, byteLength: bytes.length, touchedAt: Date.now() } satisfies Metadata)
    data.put(bytes, key)
    const cursorRequest = metadata.index("identityTouched").openCursor(IDBKeyRange.bound([identity.key, 0], [identity.key, Infinity, []]), "prev")
    let size = 0
    let count = 0
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result
      if (!cursor) return
      const record = cursor.value as Metadata
      size += record.byteLength
      if (++count > 200 || size > 50 * 1024 * 1024) { data.delete(record.key); cursor.delete() }
      cursor.continue()
    }
  }
  await complete(tx)
}
export async function deleteCachedAttachments(identityKey: string) {
  const db = await openAttachmentDatabase()
  const tx = db.transaction(["metadata", "bytes", "revoked"], "readwrite")
  tx.objectStore("revoked").put(true, identityKey)
  const request = tx.objectStore("metadata").index("identityKey").openCursor(IDBKeyRange.only(identityKey))
  request.onsuccess = () => {
    const cursor = request.result
    if (!cursor) return
    tx.objectStore("bytes").delete(cursor.primaryKey)
    cursor.delete()
    cursor.continue()
  }
  await complete(tx)
}
