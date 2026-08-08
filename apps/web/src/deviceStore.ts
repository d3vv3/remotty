import {
  generateEncryptionKeyPair,
  generateSigningKeyPair,
  signingKeyFingerprint,
  type EcPublicJwk,
  type PairingBundle,
} from "@remotty/protocol"
import { currentDeviceName } from "./deviceName"

export const DEVICE_DB_NAME = "remotty-e2ee-v2"
export const DEVICE_DB_VERSION = 2
export const CURRENT_IDENTITY_KEY = "current"
export const CURRENT_IDENTITY_MARKER = "remotty-current-identity"
const MAX_CACHE_RECORDS_PER_IDENTITY = 200
const cacheWriteQueues = new Map<string, Promise<void>>()

/** Serializes read/modify/write callers for one cache record. */
export const queueCacheWrite = (key: string, write: () => Promise<void>) => {
  const previous = cacheWriteQueues.get(key) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(write)
  const tail = next.catch(() => undefined)
  cacheWriteQueues.set(key, tail)
  return next.finally(() => { if (cacheWriteQueues.get(key) === tail) cacheWriteQueues.delete(key) })
}

export type DeviceIdentity = {
  key: string
  authorityRoom: string
  authorityId: string
  brokerUrl: string
  roomToken: string
  deviceId: string
  name: string
  signingPublicKey: EcPublicJwk
  signingPrivateKey: JsonWebKey
  encryptionPublicKey: EcPublicJwk
  encryptionPrivateKey: JsonWebKey
  relaySigningKey: EcPublicJwk
  relayEncryptionKey: EcPublicJwk
  enrolled: boolean
  inviteId?: string
  inviteSecret?: string
  deviceCertificate?: string
}

type MetaRecord = { key: string; value: string }
export type CachedResource<T = unknown> = { key: string; identityKey: string; relayId: string; sessionId?: string; resource: string; value: T; syncedAt: number }
export const cacheKeyFor = (identityKey: string, relayId: string, resource: string, sessionId = "") => `${identityKey}:${relayId}:${sessionId}:${resource}`

export const identityKeyFor = (bundle: Pick<PairingBundle, "relayId" | "roomToken">) =>
  `${bundle.relayId}:${bundle.roomToken}`

const samePublicKey = (left: EcPublicJwk, right: EcPublicJwk) =>
  left.kty === right.kty && left.crv === right.crv && left.x === right.x && left.y === right.y

const withoutInvite = (identity: DeviceIdentity): DeviceIdentity => {
  const { inviteId: _inviteId, inviteSecret: _inviteSecret, ...record } = identity
  return record
}

export const canReuseIdentity = (identity: DeviceIdentity, bundle: PairingBundle) =>
  identity.authorityRoom === identityKeyFor(bundle) &&
  samePublicKey(identity.relaySigningKey, bundle.relaySigningKey) &&
  samePublicKey(identity.relayEncryptionKey, bundle.relayEncryptionKey)

const requestResult = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"))
})

const transactionComplete = (transaction: IDBTransaction) => new Promise<void>((resolve, reject) => {
  transaction.oncomplete = () => resolve()
  transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"))
  transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction was aborted"))
})

let databasePromise: Promise<IDBDatabase> | undefined
const database = () => {
  databasePromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DEVICE_DB_NAME, DEVICE_DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains("identities")) db.createObjectStore("identities", { keyPath: "key" })
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" })
      if (!db.objectStoreNames.contains("messages")) db.createObjectStore("messages", { keyPath: "key" })
      if (!db.objectStoreNames.contains("cache")) db.createObjectStore("cache", { keyPath: "key" })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("Cannot open the device identity store"))
  })
  return databasePromise
}

const getIdentity = async (key: string) => {
  const db = await database()
  const transaction = db.transaction("identities", "readonly")
  return requestResult(transaction.objectStore("identities").get(key)) as Promise<DeviceIdentity | undefined>
}

const getIdentityForBundle = async (bundle: PairingBundle) => {
  const db = await database()
  const transaction = db.transaction("identities", "readonly")
  const identities = await requestResult(transaction.objectStore("identities").getAll()) as DeviceIdentity[]
  return identities.find((identity) => identity.authorityRoom === identityKeyFor(bundle))
}

const putIdentity = async (identity: DeviceIdentity) => {
  const db = await database()
  const transaction = db.transaction("identities", "readwrite")
  transaction.objectStore("identities").put(identity)
  await transactionComplete(transaction)
}

export const setCurrentIdentity = async (identity: DeviceIdentity) => {
  const db = await database()
  const transaction = db.transaction("meta", "readwrite")
  transaction.objectStore("meta").put({ key: CURRENT_IDENTITY_KEY, value: identity.key } satisfies MetaRecord)
  await transactionComplete(transaction)
  localStorage.setItem(CURRENT_IDENTITY_MARKER, identity.key)
}

export const clearCurrentIdentity = async (expectedKey?: string) => {
  if (!expectedKey || localStorage.getItem(CURRENT_IDENTITY_MARKER) === expectedKey) {
    localStorage.removeItem(CURRENT_IDENTITY_MARKER)
  }
  const db = await database()
  const transaction = db.transaction("meta", "readwrite")
  const store = transaction.objectStore("meta")
  if (expectedKey) {
    const request = store.get(CURRENT_IDENTITY_KEY)
    request.onsuccess = () => {
      if ((request.result as MetaRecord | undefined)?.value === expectedKey) store.delete(CURRENT_IDENTITY_KEY)
    }
  } else {
    store.delete(CURRENT_IDENTITY_KEY)
  }
  await transactionComplete(transaction)
}

export const deleteIdentity = async (identity: DeviceIdentity) => {
  const db = await database()
  const transaction = db.transaction(["identities", "meta", "messages", "cache"], "readwrite")
  transaction.objectStore("identities").delete(identity.key)
  const meta = transaction.objectStore("meta")
  const current = meta.get(CURRENT_IDENTITY_KEY)
  current.onsuccess = () => {
    if ((current.result as MetaRecord | undefined)?.value === identity.key) meta.delete(CURRENT_IDENTITY_KEY)
  }
  const messages = transaction.objectStore("messages").openCursor()
  messages.onsuccess = () => {
    const cursor = messages.result
    if (!cursor) return
    if (String(cursor.key).startsWith(`${identity.key}:`)) cursor.delete()
    cursor.continue()
  }
  const cache = transaction.objectStore("cache").openCursor()
  cache.onsuccess = () => {
    const cursor = cache.result
    if (!cursor) return
    if (String(cursor.key).startsWith(`${identity.key}:`)) cursor.delete()
    cursor.continue()
  }
  await transactionComplete(transaction)
  if (localStorage.getItem(CURRENT_IDENTITY_MARKER) === identity.key) {
    localStorage.removeItem(CURRENT_IDENTITY_MARKER)
  }
}

export const loadCachedResource = async <T>(identity: DeviceIdentity, relayId: string, resource: string, sessionId?: string) => {
  const db = await database()
  const transaction = db.transaction("cache", "readonly")
  return requestResult(transaction.objectStore("cache").get(cacheKeyFor(identity.key, relayId, resource, sessionId))) as Promise<CachedResource<T> | undefined>
}

export const loadCachedResources = async <T>(identity: DeviceIdentity, resource: string) => {
  const db = await database()
  const transaction = db.transaction("cache", "readonly")
  const records = await requestResult(transaction.objectStore("cache").getAll()) as CachedResource<T>[]
  return records.filter((record) => record.identityKey === identity.key && record.resource === resource)
}

const saveCachedResourceImpl = async <T>(identity: DeviceIdentity, relayId: string, resource: string, value: T, sessionId?: string) => {
  const db = await database()
  const transaction = db.transaction("cache", "readwrite")
  transaction.objectStore("cache").put({ key: cacheKeyFor(identity.key, relayId, resource, sessionId), identityKey: identity.key, relayId, sessionId, resource, value, syncedAt: Date.now() } satisfies CachedResource<T>)
  await transactionComplete(transaction)
  const read = db.transaction("cache", "readonly")
  const records = (await requestResult(read.objectStore("cache").getAll()) as CachedResource[])
    .filter((record) => record.identityKey === identity.key)
    .sort((left, right) => left.syncedAt - right.syncedAt)
  if (records.length <= MAX_CACHE_RECORDS_PER_IDENTITY) return
  const prune = db.transaction("cache", "readwrite")
  const store = prune.objectStore("cache")
  for (const record of records.slice(0, records.length - MAX_CACHE_RECORDS_PER_IDENTITY)) store.delete(record.key)
  await transactionComplete(prune)
}

export const saveCachedResource = <T>(identity: DeviceIdentity, relayId: string, resource: string, value: T, sessionId?: string) =>
  queueCacheWrite(cacheKeyFor(identity.key, relayId, resource, sessionId), () => saveCachedResourceImpl(identity, relayId, resource, value, sessionId))

export const loadCurrentIdentity = async () => {
  const marker = localStorage.getItem(CURRENT_IDENTITY_MARKER)
  if (!marker) return undefined
  const db = await database()
  const transaction = db.transaction("meta", "readonly")
  const current = await requestResult(transaction.objectStore("meta").get(CURRENT_IDENTITY_KEY)) as MetaRecord | undefined
  if (!current || current.value !== marker) {
    localStorage.removeItem(CURRENT_IDENTITY_MARKER)
    return undefined
  }
  const identity = await getIdentity(marker)
  if (!identity) await clearCurrentIdentity(marker)
  return identity
}

const prepareIdentityImpl = async (bundle: PairingBundle): Promise<DeviceIdentity> => {
  const authorityRoom = identityKeyFor(bundle)
  const existing = await getIdentityForBundle(bundle)
  if (existing) {
    if (!canReuseIdentity(existing, bundle)) throw new Error("The invite relay keys do not match the trusted authority.")
    const identity: DeviceIdentity = existing.enrolled
      ? { ...withoutInvite(existing), brokerUrl: bundle.brokerUrl }
      : { ...existing, brokerUrl: bundle.brokerUrl, inviteId: bundle.inviteId, inviteSecret: bundle.inviteSecret }
    await putIdentity(identity)
    await setCurrentIdentity(identity)
    return identity
  }

  const [signing, encryption] = await Promise.all([generateSigningKeyPair(), generateEncryptionKeyPair()])
  const deviceId = await signingKeyFingerprint(signing.publicKey)
  const identity: DeviceIdentity = {
    key: crypto.randomUUID(),
    authorityRoom,
    authorityId: bundle.relayId,
    brokerUrl: bundle.brokerUrl,
    roomToken: bundle.roomToken,
    deviceId,
    name: currentDeviceName(deviceId),
    signingPublicKey: signing.publicKey,
    signingPrivateKey: signing.privateKey,
    encryptionPublicKey: encryption.publicKey,
    encryptionPrivateKey: encryption.privateKey,
    relaySigningKey: bundle.relaySigningKey,
    relayEncryptionKey: bundle.relayEncryptionKey,
    enrolled: false,
    inviteId: bundle.inviteId,
    inviteSecret: bundle.inviteSecret,
  }
  await putIdentity(identity)
  await setCurrentIdentity(identity)
  return identity
}

const identityPreparations = new Map<string, Promise<DeviceIdentity>>()
export const prepareIdentity = (bundle: PairingBundle): Promise<DeviceIdentity> => {
  const key = identityKeyFor(bundle)
  const current = identityPreparations.get(key)
  if (current) return current
  const preparation = prepareIdentityImpl(bundle).finally(() => identityPreparations.delete(key))
  identityPreparations.set(key, preparation)
  return preparation
}

export const markIdentityEnrolled = async (
  identity: DeviceIdentity,
  deviceCertificate: string,
): Promise<DeviceIdentity | undefined> => {
  const db = await database()
  let enrolled: DeviceIdentity | undefined
  const transaction = db.transaction(["identities", "meta"], "readwrite")
  const identities = transaction.objectStore("identities")
  const meta = transaction.objectStore("meta")
  const current = meta.get(CURRENT_IDENTITY_KEY)
  current.onsuccess = () => {
    if ((current.result as MetaRecord | undefined)?.value !== identity.key) return
    const stored = identities.get(identity.key)
    stored.onsuccess = () => {
      const value = stored.result as DeviceIdentity | undefined
      if (!value || value.deviceId !== identity.deviceId || value.authorityRoom !== identity.authorityRoom) return
      enrolled = { ...withoutInvite(value), enrolled: true, deviceCertificate }
      identities.put(enrolled)
    }
  }
  await transactionComplete(transaction)
  if (enrolled) localStorage.setItem(CURRENT_IDENTITY_MARKER, enrolled.key)
  return enrolled
}
