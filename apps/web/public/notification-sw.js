const DB_NAME = "remotty-e2ee-v2"
const DB_VERSION = 1
const MAX_FRAME_AGE_MS = 5 * 60 * 1000
const encoder = new TextEncoder()
const decoder = new TextDecoder("utf-8", { fatal: true })

const openDatabase = () => new Promise((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, DB_VERSION)
  request.onupgradeneeded = () => {
    const database = request.result
    if (!database.objectStoreNames.contains("identities")) database.createObjectStore("identities", { keyPath: "key" })
    if (!database.objectStoreNames.contains("meta")) database.createObjectStore("meta", { keyPath: "key" })
    if (!database.objectStoreNames.contains("messages")) database.createObjectStore("messages", { keyPath: "key" })
  }
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error)
})

const requestResult = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error)
})

const currentIdentity = async (identityKey) => {
  const database = await openDatabase()
  const metaTransaction = database.transaction("meta", "readonly")
  const current = await requestResult(metaTransaction.objectStore("meta").get("current"))
  const key = current?.value
  if (identityKey && identityKey !== key) return undefined
  if (!key) return undefined
  const transaction = database.transaction("identities", "readonly")
  return requestResult(transaction.objectStore("identities").get(key))
}

const rememberMessage = async (identityKey, messageId, issuedAt) => {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("messages", "readwrite")
    const store = transaction.objectStore("messages")
    const key = `${identityKey}:${messageId}`
    const get = store.get(key)
    let fresh = false
    get.onsuccess = () => {
      if (get.result) return
      fresh = true
      store.put({ key, issuedAt })
      const records = store.getAll()
      records.onsuccess = () => {
        const cutoff = Date.now() - MAX_FRAME_AGE_MS
        for (const record of records.result) {
          if (String(record.key).startsWith(`${identityKey}:`) && record.issuedAt < cutoff) store.delete(record.key)
        }
      }
    }
    get.onerror = () => transaction.abort()
    transaction.oncomplete = () => resolve(fresh)
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}

const base64urlEncode = (value) => {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value)
  let binary = ""
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")
}

const base64urlDecode = (value) => {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]*$/.test(value) || value.length % 4 === 1) throw new Error("Invalid base64url")
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=")
  const result = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0))
  if (base64urlEncode(result) !== value) throw new Error("Non-canonical base64url")
  return result
}

const canonicalize = (value) => {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value)
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`
  if (typeof value !== "object") throw new Error("Invalid JSON value")
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`
}

const frameHeader = (frame) => ({
  type: frame.type,
  version: frame.version,
  channel: frame.channel,
  sender: frame.sender,
  recipient: frame.recipient,
  messageId: frame.messageId,
  issuedAt: frame.issuedAt,
  nonce: frame.nonce,
  ...(frame.enrollmentKey ? { enrollmentKey: frame.enrollmentKey } : {}),
})

const validPublicKey = (key) => key && key.kty === "EC" && key.crv === "P-256" &&
  typeof key.x === "string" && key.x.length === 43 && typeof key.y === "string" && key.y.length === 43

const validFrame = (frame) => frame && typeof frame === "object" && frame.type === "e2ee.frame" &&
  frame.version === 2 && frame.channel === "push" && typeof frame.sender === "string" && frame.sender &&
  typeof frame.recipient === "string" && frame.recipient && typeof frame.messageId === "string" && frame.messageId &&
  Number.isInteger(frame.issuedAt) && frame.issuedAt >= 0 && typeof frame.nonce === "string" && frame.nonce.length === 16 &&
  typeof frame.ciphertext === "string" && frame.ciphertext && typeof frame.signature === "string" && frame.signature.length === 86 &&
  frame.enrollmentKey === undefined

const deriveEncryptionKey = async (privateKey, publicKey, usages) => {
  if (!validPublicKey(publicKey)) throw new Error("Invalid relay encryption key")
  const [privateCryptoKey, publicCryptoKey] = await Promise.all([
    crypto.subtle.importKey("jwk", privateKey, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]),
    crypto.subtle.importKey("jwk", publicKey, { name: "ECDH", namedCurve: "P-256" }, false, []),
  ])
  const secret = await crypto.subtle.deriveBits({ name: "ECDH", public: publicCryptoKey }, privateCryptoKey, 256)
  const material = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveKey"])
  return crypto.subtle.deriveKey({
    name: "HKDF",
    hash: "SHA-256",
    salt: new Uint8Array(32),
    info: encoder.encode("remotty:e2ee:v2:aes-256-gcm"),
  }, material, { name: "AES-GCM", length: 256 }, false, usages)
}

const verifyAndOpen = async (frame, identity) => {
  if (!validFrame(frame) || frame.recipient !== identity.deviceId || Math.abs(Date.now() - frame.issuedAt) > MAX_FRAME_AGE_MS) {
    throw new Error("Rejected Push frame")
  }
  if (!validPublicKey(identity.relaySigningKey)) throw new Error("Invalid relay signing key")
  const signingKey = await crypto.subtle.importKey("jwk", identity.relaySigningKey, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"])
  const signingInput = encoder.encode(canonicalize({ ...frameHeader(frame), ciphertext: frame.ciphertext }))
  const verified = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    signingKey,
    base64urlDecode(frame.signature),
    signingInput,
  )
  if (!verified) throw new Error("Invalid Push signature")
  const encryptionKey = await deriveEncryptionKey(identity.encryptionPrivateKey, identity.relayEncryptionKey, ["decrypt"])
  const plaintext = await crypto.subtle.decrypt({
    name: "AES-GCM",
    iv: base64urlDecode(frame.nonce),
    additionalData: encoder.encode(canonicalize(frameHeader(frame))),
  }, encryptionKey, base64urlDecode(frame.ciphertext))
  return JSON.parse(decoder.decode(plaintext))
}

const notificationData = (value, identityKey) => {
  if (!value || typeof value !== "object" || typeof value.workspaceRelayId !== "string") throw new Error("Invalid notification data")
  const data = { workspaceRelayId: value.workspaceRelayId, identityKey }
  if (typeof value.workspaceId === "string") data.workspaceId = value.workspaceId
  for (const key of ["sessionId", "targetSessionId", "permissionId", "questionId"]) {
    if (typeof value[key] === "string") data[key] = value[key]
  }
  return data
}

const handlePush = async (frame) => {
  const identity = await currentIdentity()
  if (!identity?.enrolled) return
  const payload = await verifyAndOpen(frame, identity)
  if (!payload || typeof payload !== "object" || payload.data?.workspaceRelayId !== frame.sender) return
  if (!(await rememberMessage(identity.key, frame.messageId, frame.issuedAt))) return
  if (payload.type === "notification.close" && typeof payload.tag === "string") {
    const notifications = await self.registration.getNotifications({ tag: payload.tag })
    for (const notification of notifications) notification.close()
    return
  }
  if (payload.type !== "notification.show" || typeof payload.title !== "string" || !payload.title ||
    typeof payload.body !== "string" || typeof payload.tag !== "string" || !Array.isArray(payload.actions)) return
  const actions = payload.actions.filter((action) => action && typeof action.action === "string" && typeof action.title === "string")
    .map(({ action, title }) => ({ action, title }))
  await self.registration.showNotification(payload.title, {
    body: payload.body,
    tag: payload.tag,
    requireInteraction: payload.requireInteraction === true,
    actions,
    data: notificationData(payload.data, identity.key),
    icon: "/icon-192.png",
    badge: "/notification-badge.png",
  })
}

self.addEventListener("push", (event) => {
  if (!event.data) return
  event.waitUntil(Promise.resolve().then(() => event.data.json()).then(handlePush).catch(() => undefined))
})

self.addEventListener("message", (event) => {
  if (event.data?.type === "notification.capabilities") {
    event.ports[0]?.postMessage({ closeNotifications: true })
    return
  }
  if (event.data?.type !== "notification.close" || typeof event.data.tag !== "string") return
  event.waitUntil(self.registration.getNotifications({ tag: event.data.tag }).then((notifications) => {
    for (const notification of notifications) notification.close()
  }))
})

const createHeader = (identity, relayId) => {
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  return {
    type: "e2ee.frame",
    version: 2,
    channel: "data",
    sender: identity.deviceId,
    recipient: relayId,
    messageId: crypto.randomUUID(),
    issuedAt: Date.now(),
    nonce: base64urlEncode(nonce),
  }
}

const sealCommand = async (command, identity, relayId) => {
  const header = createHeader(identity, relayId)
  const encryptionKey = await deriveEncryptionKey(identity.encryptionPrivateKey, identity.relayEncryptionKey, ["encrypt"])
  const ciphertext = base64urlEncode(await crypto.subtle.encrypt({
    name: "AES-GCM",
    iv: base64urlDecode(header.nonce),
    additionalData: encoder.encode(canonicalize(header)),
  }, encryptionKey, encoder.encode(canonicalize(command))))
  const signingKey = await crypto.subtle.importKey("jwk", identity.signingPrivateKey, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"])
  const signature = base64urlEncode(await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    signingKey,
    encoder.encode(canonicalize({ ...header, ciphertext })),
  ))
  return { ...header, ciphertext, signature }
}

const actionEndpoint = (identity) => {
  const url = new URL(identity.brokerUrl)
  url.protocol = url.protocol === "wss:" ? "https:" : "http:"
  url.pathname = "/push/action"
  url.search = ""
  url.hash = ""
  return url
}

const sendPermissionAction = async (action, data) => {
  if (!["reject", "once", "always"].includes(action) || typeof data?.sessionId !== "string" ||
    typeof data.permissionId !== "string" || typeof data.workspaceRelayId !== "string") return
  const identity = await currentIdentity(data.identityKey)
  if (!identity?.enrolled) return
  const frame = await sealCommand({
    type: "permission.reply",
    requestId: crypto.randomUUID(),
    sessionId: typeof data.targetSessionId === "string" ? data.targetSessionId : data.sessionId,
    permissionId: data.permissionId,
    response: action,
  }, identity, data.workspaceRelayId)
  await fetch(actionEndpoint(identity), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ roomToken: identity.roomToken, frame }),
  })
}

const applicationUrl = (data) => {
  const url = new URL("/app", self.location.origin)
  if (typeof data?.sessionId === "string") {
    const sessionKey = typeof data.workspaceId === "string" || typeof data.workspaceRelayId === "string"
      ? `${data.workspaceId || data.workspaceRelayId}:${data.sessionId}`
      : data.sessionId
    url.searchParams.set("session", sessionKey)
  }
  return url
}

const openApplication = async (data) => {
  const url = applicationUrl(data)
  const windows = await clients.matchAll({ type: "window", includeUncontrolled: true })
  const client = windows[0]
  if (client) {
    await client.navigate(url.href)
    return client.focus()
  }
  return clients.openWindow(url.href)
}

const notificationClickMode = (action) => action ? "action" : "open"

self.addEventListener("notificationclick", (event) => {
  event.preventDefault?.()
  event.stopImmediatePropagation?.()
  event.notification.close()
  const data = event.notification.data
  const mode = notificationClickMode(event.action)
  if (mode === "action") {
    event.waitUntil(sendPermissionAction(event.action, data).catch(() => undefined))
    return
  }
  event.waitUntil(openApplication(data))
})
