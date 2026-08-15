import { useCallback, useEffect, useRef, useState } from "react"
import {
  brokerTransportControlSchema,
  canonicalJsonFingerprint,
  canonicalMessageValue,
  e2eeFrameSchema,
  openJsonPayload,
  permissionRequestSchema,
  relayMessageSchema,
  sealEnrollmentPayload,
  sealJsonPayload,
  signCanonicalJson,
  transportProofPayload,
  type ClientCommand,
  type JsonValue,
  type PairingBundle,
  type QuestionRequest,
  type SessionSummary,
  type MessageDeltaManifest,
} from "@remotty/protocol"
import { currentDeviceName } from "./deviceName"
import {
  deleteIdentity,
  loadCachedResource,
  loadCachedResources,
  loadCurrentIdentity,
  markIdentityEnrolled,
  prepareIdentity,
  setCurrentIdentity,
  saveCachedResource,
  type DeviceIdentity,
} from "./deviceStore"
import { acceptsRelayPosition, aggregateRelaySlices, bumpResourceRevisions, bumpSessionRevisions, commandRelayId, normalizeRelaySlice, resolveConnectedWorkspaceRelay, sessionRevisionKey, stableWorkspaceKey, type RelaySlice, type ResourceRevisions } from "./relayState"
import { addChunk, assembledMessages, completeChunks, createChunkAssembly, exactManifestMessages, HANDSHAKE_TIMEOUT_MS, hasSequenceGap, healthSummary, orderByManifest, readOnlyCommand, reconnectDelay, requestInactivityMs, retryPlan, shouldExpireHandshakeWatchdog, shouldReconnectTransportOnResume, validManifest, type ChunkAssembly } from "./resilience"
import { messageCacheErrorDetail, shouldReportCacheFailure, type CacheFailure, verifyDeltaSnapshot } from "./messageCache"
import { retainedSessionState } from "./sessionState"
import { serializePushSubscription } from "./pushSubscription"

type PendingRequest = {
  relayId: string
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timeout: number
  command: RelayRequest
  startedAt: number
  chunks: ChunkAssembly
  generation: number
  progress?: (messages: unknown[], isActive: () => boolean) => void | Promise<void>
  manifestIds?: string[]
  deltaManifest?: MessageDeltaManifest
  verifiedMessageIds: Set<string>
  progressChain: Promise<void>
  progressSignature?: string
  completionScheduled: boolean
}

/** Keeps the manifest-provided order while omitting unverified or duplicate message ids. */
export const verifiedCanonicalMessages = <T>(messages: T[], verified: ReadonlySet<string>) => {
  const seen = new Set<string>()
  return messages.filter((message) => {
    const id = (message as { info?: { id?: unknown } }).info?.id
    if (typeof id !== "string" || !id || !verified.has(id) || seen.has(id)) return false
    seen.add(id)
    return true
  })
}

export const legacyManifestCompatible = (chunks: ChunkAssembly, total: number) =>
  chunks.total === undefined || chunks.total === total

/** Resolves a transient relay ID when available; stable workspace IDs need no live slice. */
export const cacheNamespace = (cacheRelayId: string, relay?: Pick<RelaySlice["relay"], "workspaceId" | "hostname" | "workspace">) =>
  relay ? stableWorkspaceKey(relay) : cacheRelayId

/** Computes legacy progress only after its canonical manifest is available. */
export const legacyChunkState = (chunks: ChunkAssembly, manifestIds: string[] | undefined, verified: ReadonlySet<string>) => {
  const messages = assembledMessages(chunks)
  if (!manifestIds) return { progress: [] as unknown[], complete: false as const }
  const progress = verifiedCanonicalMessages(orderByManifest(messages, manifestIds), verified)
  if (!completeChunks(chunks)) return { progress, complete: false as const }
  return { progress, complete: true as const, messages: exactManifestMessages(messages, manifestIds) }
}

/** Preserve callback order without blocking encrypted frame receipt. */
export const queueProgress = (pending: Pick<PendingRequest, "progress" | "progressChain">, messages: unknown[], onFailure?: (cause: unknown) => void, isActive: () => boolean = () => true) => {
  if (!messages.length || !pending.progress) return pending.progressChain
  pending.progressChain = pending.progressChain.then(() => isActive() ? pending.progress?.(messages, isActive) : undefined)
  void pending.progressChain.catch((cause) => { onFailure?.(cause) })
  return pending.progressChain
}

const progressSignature = (messages: unknown[]) => JSON.stringify(messages.map((message) => (message as { info?: { id?: unknown } }).info?.id))

/** Queues a canonical snapshot only when it differs from this request's prior progress. */
export const queueProgressSnapshot = (pending: Pick<PendingRequest, "progress" | "progressChain" | "progressSignature" | "completionScheduled">, messages: unknown[], isActive: () => boolean, onFailure?: (cause: unknown) => void) => {
  if (!messages.length || !pending.progress || pending.completionScheduled) return pending.progressChain
  const signature = progressSignature(messages)
  if (signature === pending.progressSignature) return pending.progressChain
  pending.progressSignature = signature
  return queueProgress(pending, messages, onFailure, isActive)
}

export type RelayRequest = ClientCommand extends infer Command
  ? Command extends { requestId: string } ? Omit<Command, "requestId"> : never
  : never

const MAX_FRAME_AGE_MS = 5 * 60 * 1_000
const MAX_RECENT_MESSAGES = 1_000

export const commandForRelayCapabilities = (command: RelayRequest, capabilities?: { messageChunks?: boolean; messageDelta?: 1; promptMessageId?: 1; relayPromptMessageId?: 1; workspaceDiff?: 1 }): RelayRequest => {
  if (command.type === "session.prompt") {
    const { messageId: _messageId, ...legacy } = command
    return legacy
  }
  if (command.type === "session.messages" && capabilities?.messageDelta && command.sync) return command
  if (command.type === "session.messages" && capabilities?.messageChunks) return { ...command, chunked: true, sync: undefined }
  if (command.type === "workspace.diff" && !capabilities?.workspaceDiff) return { type: "session.diff", sessionId: command.sessionId }
  return command
}

const httpBrokerUrl = (identity: DeviceIdentity) => {
  const url = new URL(identity.brokerUrl)
  url.protocol = url.protocol === "wss:" ? "https:" : "http:"
  url.pathname = "/"
  url.search = ""
  url.hash = ""
  return url
}

const endpoint = (identity: DeviceIdentity, path: string) => new URL(path, httpBrokerUrl(identity))

const applicationServerKey = (value: string) => {
  const padding = "=".repeat((4 - (value.length % 4)) % 4)
  const bytes = atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"))
  return Uint8Array.from(bytes, (character) => character.charCodeAt(0))
}

const registerPush = async (identity: DeviceIdentity) => {
  if (!identity.enrolled || !identity.deviceCertificate) throw new Error("Finish device enrollment before enabling notifications.")
  const registration = await navigator.serviceWorker.ready
  const { publicKey } = (await fetch(endpoint(identity, "push/public-key")).then((response) => {
    if (!response.ok) throw new Error("Cannot read the Push server key.")
    return response.json()
  })) as { publicKey: string }
  const key = applicationServerKey(publicKey)
  const existing = await registration.pushManager.getSubscription()
  const existingKey = existing?.options.applicationServerKey
    ? new Uint8Array(existing.options.applicationServerKey)
    : undefined
  const keyChanged = existingKey &&
    (existingKey.length !== key.length || existingKey.some((byte, index) => byte !== key[index]))
  if (keyChanged) await existing?.unsubscribe()
  const subscription = !keyChanged && existing
    ? existing
    : await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
  const response = await fetch(endpoint(identity, "push/subscribe"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(await signedPushRequest(identity, "subscribe", { subscription: serializePushSubscription(subscription) })),
  })
  if (!response.ok) throw new Error("The broker rejected the Push subscription.")
}

const unregisterPush = async (identity: DeviceIdentity) => {
  if (!("serviceWorker" in navigator)) return
  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
  if (!subscription) return
  await fetch(endpoint(identity, "push/unsubscribe"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(await signedPushRequest(identity, "unsubscribe", { endpoint: subscription.endpoint })),
  }).catch(() => undefined)
  await subscription.unsubscribe()
}

const closeNotification = (tag: string) => {
  if (!("serviceWorker" in navigator)) return
  void navigator.serviceWorker.ready.then((registration) => {
    registration.active?.postMessage({ type: "notification.close", tag })
  })
}

const jsonValue = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue

const signedPushRequest = async (
  identity: DeviceIdentity,
  operation: "subscribe" | "unsubscribe",
  details: Record<string, unknown>,
) => {
  const authorization = jsonValue({
    operation,
    roomToken: identity.roomToken,
    deviceId: identity.deviceId,
    issuedAt: Date.now(),
    nonce: crypto.randomUUID(),
    ...details,
  }) as Record<string, JsonValue>
  return {
    ...authorization,
    signingPublicKey: identity.signingPublicKey,
    relaySigningKey: identity.relaySigningKey,
    deviceCertificate: identity.deviceCertificate,
    signature: await signCanonicalJson(authorization, identity.signingPrivateKey),
  }
}

export function useRelay(initialBundle?: PairingBundle) {
  const [connection, setConnection] = useState<"disconnected" | "connecting" | "online" | "unstable" | "offline">("connecting")
  const [enrolled, setEnrolled] = useState<boolean>()
  const [relay, setRelay] = useState<ReturnType<typeof aggregateRelaySlices>["relay"]>()
  const [relays, setRelays] = useState<ReturnType<typeof aggregateRelaySlices>["relays"]>([])
  const [sessions, setSessions] = useState<ReturnType<typeof aggregateRelaySlices>["sessions"]>([])
  const [agents, setAgents] = useState<ReturnType<typeof aggregateRelaySlices>["agents"]>([])
  const [permissions, setPermissions] = useState<ReturnType<typeof aggregateRelaySlices>["permissions"]>([])
  const [questions, setQuestions] = useState<ReturnType<typeof aggregateRelaySlices>["questions"]>([])
  const [subagents, setSubagents] = useState<ReturnType<typeof aggregateRelaySlices>["subagents"]>([])
  const [subagentsByRoot, setSubagentsByRoot] = useState<ReturnType<typeof aggregateRelaySlices>["subagentsByRoot"]>(new Map())
  const [sessionRevisions, setSessionRevisions] = useState<Record<string, number>>({})
  const [resourceRevisions, setResourceRevisions] = useState<ResourceRevisions>({})
  const [notificationsEnabled, setNotificationsEnabled] = useState(
    () => localStorage.getItem("remotty-notifications") === "enabled" &&
      typeof Notification !== "undefined" && Notification.permission === "granted",
  )
  const [error, setError] = useState<string>()
  const [serviceConnected, setServiceConnected] = useState(false)
  const [relayHealth, setRelayHealth] = useState<Record<string, { lastContact?: number; rtt?: number; timedOut?: boolean; failures?: number }>>({})
  const [lastSyncedAt, setLastSyncedAt] = useState<number>()
  const socketRef = useRef<WebSocket | undefined>(undefined)
  const identityRef = useRef<DeviceIdentity | undefined>(undefined)
  const pendingRef = useRef(new Map<string, PendingRequest>())
  const connectedRelaysRef = useRef(new Set<string>())
  const slicesRef = useRef(new Map<string, RelaySlice>())
  const sessionRelaysRef = useRef(new Map<string, string>())
  const recentMessageIdsRef = useRef(new Set<string>())
  const recentMessageQueueRef = useRef<string[]>([])
  const connectionEpochRef = useRef(0)
  const cleanupRef = useRef<Promise<void>>(Promise.resolve())
  const reconnectAttemptRef = useRef(0)
  const recoveryInFlightRef = useRef(new Set<string>())
  const snapshotInvalidationRef = useRef(new Set<string>())
  const socketGenerationRef = useRef(0)
  const authenticatedRef = useRef(false)
  const hiddenAtRef = useRef<number | undefined>(undefined)
  const lastTransportActivityRef = useRef<number | undefined>(undefined)
  const lastRecoveryAtRef = useRef(0)
  const snapshotCacheFailureRef = useRef<CacheFailure | undefined>(undefined)

  const publishSlices = useCallback(() => {
    const state = aggregateRelaySlices(slicesRef.current, connectedRelaysRef.current)
    sessionRelaysRef.current = state.sessionRelays
    setRelay(state.relay)
    setRelays(state.relays)
    setSessions(state.sessions)
    setAgents(state.agents)
    setPermissions(state.permissions)
    setQuestions(state.questions)
    setSubagents(state.subagents)
    setSubagentsByRoot(state.subagentsByRoot)
  }, [])

  const rememberMessage = useCallback((messageId: string) => {
    recentMessageIdsRef.current.add(messageId)
    recentMessageQueueRef.current.push(messageId)
    if (recentMessageQueueRef.current.length > MAX_RECENT_MESSAGES) {
      recentMessageIdsRef.current.delete(recentMessageQueueRef.current.shift()!)
    }
  }, [])

  const sendCommandFrame = useCallback(async (identity: DeviceIdentity, relayId: string, command: ClientCommand) => {
    const socket = socketRef.current
    if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error("Relay is offline")
    const frame = await sealJsonPayload(jsonValue(command), {
      channel: "data",
      sender: identity.deviceId,
      recipient: relayId,
      messageId: crypto.randomUUID(),
      issuedAt: Date.now(),
      senderSigningPrivateKey: identity.signingPrivateKey,
      senderEncryptionPrivateKey: identity.encryptionPrivateKey,
      recipientEncryptionPublicKey: identity.relayEncryptionKey,
    })
    if (socketRef.current !== socket || socket.readyState !== WebSocket.OPEN) throw new Error("Relay is offline")
    socket.send(JSON.stringify(frame))
  }, [])

  const requestFromRelay = useCallback((identity: DeviceIdentity, relayId: string, command: RelayRequest, progress?: (messages: unknown[], isActive: () => boolean) => void | Promise<void>) => {
    if (!connectedRelaysRef.current.has(relayId)) return Promise.reject(new Error("The workspace relay is offline."))
    const requestId = crypto.randomUUID()
    return new Promise<unknown>((resolve, reject) => {
      const generation = socketGenerationRef.current
      const timeout = window.setTimeout(() => {
        pendingRef.current.delete(requestId)
        reject(new Error("The relay did not respond."))
      }, requestInactivityMs(command.type))
      pendingRef.current.set(requestId, { relayId, resolve, reject, timeout, command, startedAt: Date.now(), chunks: createChunkAssembly(), generation, progress, verifiedMessageIds: new Set(), progressChain: Promise.resolve(), completionScheduled: false })
      void sendCommandFrame(identity, relayId, { ...command, requestId } as ClientCommand).catch((cause) => {
        window.clearTimeout(timeout)
        pendingRef.current.delete(requestId)
        reject(cause)
      })
    })
  }, [sendCommandFrame])

  const requestSnapshots = useCallback((identity: DeviceIdentity, relayIds: Iterable<string>, waitForReply = false) => {
    const deviceName = currentDeviceName(identity.deviceId)
    const targets = [...relayIds]
    for (const relayId of targets) snapshotInvalidationRef.current.add(relayId)
    const requests = targets.map((relayId) => {
      if (waitForReply) return requestFromRelay(identity, relayId, { type: "snapshot.request", deviceName })
      return sendCommandFrame(identity, relayId, { type: "snapshot.request", requestId: crypto.randomUUID(), deviceName })
    })
    return Promise.all(requests)
  }, [requestFromRelay, sendCommandFrame])

  const applyEvent = useCallback((
    relayId: string,
    event: { type: string; properties: unknown },
    instanceId: string | undefined,
    sequence: number,
  ) => {
    const slice = slicesRef.current.get(relayId)
    if (!slice || !instanceId || slice.relay.instanceId !== instanceId || sequence <= (slice.sequence ?? -1)) return
    if (hasSequenceGap(slice.sequence, sequence)) {
      if (recoveryInFlightRef.current.has(relayId)) return
      recoveryInFlightRef.current.add(relayId)
      const identity = identityRef.current
      if (identity) void requestSnapshots(identity, [relayId]).catch(() => undefined)
      return
    }
    slice.sequence = sequence
    const properties = event.properties as Record<string, unknown>
    const info = properties.info as Record<string, unknown> | undefined
    const part = properties.part as Record<string, unknown> | undefined
    const sessionID = String(properties.sessionID ?? info?.sessionID ?? part?.sessionID ?? "")
    const resource = ["message.updated", "message.part.updated", "message.part.delta"].includes(event.type) ? "messages"
      : event.type === "todo.updated" ? "todos" : event.type === "session.diff" ? "diffs"
      : ["session.idle", "session.status", "session.error"].includes(event.type) ? "messages" : undefined
    if (sessionID && resource) {
      const revisionKey = sessionRevisionKey(slice.relay, sessionID)
      setSessionRevisions((current) => ({ ...current, [revisionKey]: (current[revisionKey] ?? 0) + 1 }))
      setResourceRevisions((current) => bumpResourceRevisions(current, slice.relay, [sessionID], [resource]))
    }
    if (["session.status", "session.idle", "session.error"].includes(event.type)) {
      const status = event.type === "session.idle" ? "idle" : event.type === "session.error" ? "error"
        : (properties.status as { type?: SessionSummary["status"] })?.type
      slice.sessions = slice.sessions.map((session) => session.id === sessionID && status ? { ...session, status } : session)
      slice.subagents = slice.subagents.map((session) => session.id === sessionID && status ? { ...session, status } : session)
    }
    if (["permission.updated", "permission.asked", "permission.v2.asked"].includes(event.type)) {
      const parsed = permissionRequestSchema.safeParse(properties)
      if (parsed.success) slice.permissions = [...slice.permissions.filter((item) => item.id !== parsed.data.id), parsed.data]
    }
    if (["permission.replied", "permission.v2.replied"].includes(event.type)) {
      const permissionId = String(properties.id ?? properties.requestID ?? properties.permissionID ?? "")
      slice.permissions = slice.permissions.filter((item) => item.id !== permissionId)
      if (permissionId) closeNotification(`${relayId}:permission-${permissionId}`)
    }
    if (event.type === "question.asked") {
      const question = properties as QuestionRequest
      slice.questions = [...slice.questions.filter((item) => item.id !== question.id), question]
    }
    if (["question.replied", "question.rejected"].includes(event.type)) {
      const questionId = String(properties.requestID ?? "")
      slice.questions = slice.questions.filter((item) => item.id !== questionId)
      if (questionId) closeNotification(`${relayId}:question-${questionId}`)
    }
    if (["session.status", "session.idle", "session.error", "permission.updated", "permission.asked", "permission.v2.asked", "permission.replied", "permission.v2.replied", "question.asked", "question.replied", "question.rejected"].includes(event.type)) publishSlices()
  }, [publishSlices, requestSnapshots])

  const handleEncryptedFrame = useCallback(async (frameValue: unknown, epoch: number) => {
    const identity = identityRef.current
    if (!identity) return
    const identityKey = identity.key
    const parsed = e2eeFrameSchema.safeParse(frameValue)
    if (!parsed.success) return
    const frame = parsed.data
    if (frame.channel !== "data" || frame.recipient !== identity.deviceId ||
      Math.abs(Date.now() - frame.issuedAt) > MAX_FRAME_AGE_MS || recentMessageIdsRef.current.has(frame.messageId)) return
    try {
      const payload = await openJsonPayload<unknown>(frame, {
        recipient: identity.deviceId,
        recipientEncryptionPrivateKey: identity.encryptionPrivateKey,
        senderEncryptionPublicKey: identity.relayEncryptionKey,
        senderSigningPublicKey: identity.relaySigningKey,
      })
      if (connectionEpochRef.current !== epoch || identityRef.current?.key !== identityKey) return
      if (recentMessageIdsRef.current.has(frame.messageId)) return
      rememberMessage(frame.messageId)
      setRelayHealth((current) => ({ ...current, [frame.sender]: { ...current[frame.sender], lastContact: Date.now(), timedOut: false } }))

      if (typeof payload === "object" && payload !== null && (payload as { type?: unknown }).type === "enrollment.accepted") {
        const accepted = payload as { type: string; deviceId?: unknown; relayId?: unknown; deviceCertificate?: unknown }
        if (accepted.deviceId !== identity.deviceId || accepted.relayId !== frame.sender ||
          typeof accepted.deviceCertificate !== "string") return
        const enrolled = await markIdentityEnrolled(identity, accepted.deviceCertificate)
        if (!enrolled) return
        if (connectionEpochRef.current !== epoch || identityRef.current?.key !== identityKey) {
          if (identityRef.current) await setCurrentIdentity(identityRef.current)
          return
        }
        identityRef.current = enrolled
        setEnrolled(true)
        setError(undefined)
        await requestSnapshots(enrolled, connectedRelaysRef.current)
        if (localStorage.getItem("remotty-notifications") === "enabled") await registerPush(enrolled)
        return
      }
      if (typeof payload === "object" && payload !== null && (payload as { type?: unknown }).type === "enrollment.rejected") {
        const rejected = payload as { deviceId?: unknown; message?: unknown }
        if (rejected.deviceId === identity.deviceId && typeof rejected.message === "string") {
          setError(`Enrollment failed: ${rejected.message}`)
        }
        return
      }

      const relayMessage = relayMessageSchema.safeParse(payload)
      if (!relayMessage.success) {
        console.warn("Rejected decrypted relay payload", relayMessage.error.issues)
        return
      }
      const data = relayMessage.data
      if (data.type === "device.revoked") {
        if (data.deviceId !== identity.deviceId) return
        await sendCommandFrame(identity, frame.sender, {
          type: "snapshot.request",
          requestId: crypto.randomUUID(),
        }).catch(() => undefined)
        ++connectionEpochRef.current
        const socket = socketRef.current
        socketRef.current = undefined
        identityRef.current = undefined
        socket?.close(1000, "Device revoked")
        await deleteIdentity(identity)
        connectedRelaysRef.current.clear()
        slicesRef.current.clear()
        sessionRelaysRef.current.clear()
        for (const pending of pendingRef.current.values()) {
          window.clearTimeout(pending.timeout)
          pending.reject(new Error("This browser device was revoked."))
        }
        pendingRef.current.clear()
        retainedSessionState.clear()
        setSessionRevisions({})
        setResourceRevisions({})
        publishSlices()
        history.replaceState({}, "", "/pair")
        setConnection("disconnected")
        setEnrolled(false)
        setNotificationsEnabled(false)
        setError("This browser device was revoked. Pair it again to restore access.")
      } else if (data.type === "relay.hello") {
        if (data.relay.id !== frame.sender) return
        const current = slicesRef.current.get(frame.sender)
        if (!acceptsRelayPosition(current, data.relay, data.sequence)) return
        slicesRef.current.set(frame.sender, current ? { ...current, relay: data.relay } : {
          relay: data.relay, sessions: [], subagents: [], agents: [], permissions: [], questions: [], sequence: data.sequence,
        })
        if (data.relay.workspaceId || data.relay.workspace) {
          const superseded: string[] = []
          for (const [id, slice] of slicesRef.current) {
            if (id !== frame.sender && stableWorkspaceKey(slice.relay) === stableWorkspaceKey(data.relay)) { slicesRef.current.delete(id); superseded.push(id) }
          }
          if (superseded.length) setRelayHealth((current) => { const next = { ...current }; for (const id of superseded) delete next[id]; return next })
        }
        slicesRef.current.get(frame.sender)!.sequence = data.sequence
        publishSlices()
      } else if (data.type === "relay.snapshot") {
        if (data.relay.id !== frame.sender) return
        const current = slicesRef.current.get(frame.sender)
        if (!acceptsRelayPosition(current, data.relay, data.sequence)) return
        slicesRef.current.set(frame.sender, {
          relay: data.relay,
          sessions: data.sessions,
          subagents: data.subagents,
          agents: data.agents,
          permissions: data.permissions,
          questions: data.questions,
          sequence: data.sequence,
        })
        if (data.relay.workspaceId || data.relay.workspace) {
          const superseded: string[] = []
          for (const [id, slice] of slicesRef.current) {
            if (id !== frame.sender && stableWorkspaceKey(slice.relay) === stableWorkspaceKey(data.relay)) { slicesRef.current.delete(id); superseded.push(id) }
          }
          if (superseded.length) setRelayHealth((current) => { const next = { ...current }; for (const id of superseded) delete next[id]; return next })
        }
        void saveCachedResource(identity, stableWorkspaceKey(data.relay), "snapshot", {
          relay: data.relay, sessions: data.sessions, subagents: data.subagents, agents: data.agents, permissions: data.permissions, questions: data.questions, sequence: data.sequence,
        }).then(() => {
          snapshotCacheFailureRef.current = undefined
        }).catch((cause) => {
          const message = `Workspace state is current, but local cache could not be saved: ${messageCacheErrorDetail(cause)}`
          const now = Date.now()
          if (!shouldReportCacheFailure(snapshotCacheFailureRef.current, message, now)) return
          snapshotCacheFailureRef.current = { message, at: now }
          setError(message)
        })
        setLastSyncedAt(Date.now())
        recoveryInFlightRef.current.delete(frame.sender)
        if (snapshotInvalidationRef.current.delete(frame.sender)) {
          setSessionRevisions((current) => bumpSessionRevisions(current, data.relay, data.sessions.map((session) => session.id)))
          setResourceRevisions((current) => bumpResourceRevisions(current, data.relay, [...data.sessions, ...data.subagents].map((session) => session.id), ["messages", "todos", "diffs"]))
        }
        publishSlices()
      } else if (data.type === "relay.event") {
        applyEvent(frame.sender, data.event, data.instanceId, data.sequence)
      } else if (data.type === "session.messages.manifest") {
        const pending = pendingRef.current.get(data.requestId)
        if (!pending || pending.relayId !== frame.sender || pending.command.type !== "session.messages") return
        if (!await verifyDeltaSnapshot(data.manifest) || pendingRef.current.get(data.requestId) !== pending) return
        pending.deltaManifest = data.manifest
        pending.chunks.total = data.manifest.chunkCount
        if (data.manifest.chunkCount === 0) {
          window.clearTimeout(pending.timeout)
          pending.timeout = window.setTimeout(() => { pendingRef.current.delete(data.requestId); pending.reject(new Error("Message progress timed out.")) }, requestInactivityMs(pending.command.type))
          void pending.progressChain.then(() => {
            if (pendingRef.current.get(data.requestId) !== pending || pending.generation !== socketGenerationRef.current) return
            window.clearTimeout(pending.timeout)
            pendingRef.current.delete(data.requestId)
            pending.resolve({ deltaManifest: data.manifest, messages: [] })
          }).catch((cause) => {
            if (pendingRef.current.get(data.requestId) !== pending) return
            window.clearTimeout(pending.timeout)
            pendingRef.current.delete(data.requestId)
            pending.reject(cause instanceof Error ? cause : new Error(String(cause)))
          })
          return
        }
        window.clearTimeout(pending.timeout)
        pending.timeout = window.setTimeout(() => { pendingRef.current.delete(data.requestId); pending.reject(new Error("The relay stopped sending messages.")) }, requestInactivityMs(pending.command.type))
      } else if (data.type === "session.messages.chunk") {
        const chunk = data.chunk
        const pending = pendingRef.current.get(chunk.requestId)
        if (!pending || pending.relayId !== frame.sender || !pending.deltaManifest || pending.deltaManifest.snapshotId !== chunk.snapshotId || pending.deltaManifest.chunkCount !== chunk.total) return
        const expected = new Map(pending.deltaManifest.manifest.map((entry) => [entry.id, entry.fingerprint]))
        const upserts = new Set(pending.deltaManifest.upserts)
        const records: unknown[] = []
        for (const record of chunk.records) {
          if (!upserts.has(record.id) || expected.get(record.id) !== record.fingerprint || (record.message as { info?: { id?: unknown } }).info?.id !== record.id) return
          const actual = await canonicalJsonFingerprint(canonicalMessageValue(jsonValue(record.message)))
          if (pendingRef.current.get(chunk.requestId) !== pending || pending.generation !== socketGenerationRef.current || actual !== record.fingerprint) return
          records.push(record.message)
          pending.verifiedMessageIds.add(record.id)
        }
        const fragment = chunk.fragments[0]
        if (chunk.fragments.length > 1 || (fragment && (!upserts.has(fragment.messageId) || expected.get(fragment.messageId) !== fragment.fingerprint))) return
        if (!addChunk(pending.chunks, { index: chunk.index, total: chunk.total, result: fragment ? { fragment } : records })) return
        window.clearTimeout(pending.timeout)
        pending.timeout = window.setTimeout(() => { pendingRef.current.delete(chunk.requestId); pending.reject(new Error("The relay stopped sending messages.")) }, requestInactivityMs(pending.command.type))
        const messages = orderByManifest(assembledMessages(pending.chunks), pending.deltaManifest.manifest.map((entry) => entry.id))
        for (const message of messages) {
          const id = (message as { info?: { id?: unknown } }).info?.id
          if (typeof id !== "string" || pending.verifiedMessageIds.has(id)) continue
          const fingerprint = expected.get(id)
          if (!fingerprint || await canonicalJsonFingerprint(canonicalMessageValue(jsonValue(message))) !== fingerprint) return
          if (pendingRef.current.get(chunk.requestId) !== pending || pending.generation !== socketGenerationRef.current) return
          pending.verifiedMessageIds.add(id)
        }
        const progress = verifiedCanonicalMessages(messages, pending.verifiedMessageIds)
        const isActive = () => pendingRef.current.get(chunk.requestId) === pending && pending.generation === socketGenerationRef.current
        queueProgressSnapshot(pending, progress, isActive, (cause) => {
          if (!isActive()) return
          window.clearTimeout(pending.timeout)
          pendingRef.current.delete(chunk.requestId)
          pending.reject(cause instanceof Error ? cause : new Error(String(cause)))
        })
        if (pendingRef.current.get(chunk.requestId) !== pending || pending.generation !== socketGenerationRef.current) return
        if (completeChunks(pending.chunks)) {
          const messages = assembledMessages(pending.chunks)
          const received = new Map<string, unknown>()
          for (const message of messages) {
            const id = (message as { info?: { id?: unknown } }).info?.id
            if (typeof id !== "string" || received.has(id)) return
            received.set(id, message)
          }
          for (const id of pending.deltaManifest.upserts) {
            const message = received.get(id)
            const fingerprint = expected.get(id)
            if (!message || !fingerprint) {
              window.clearTimeout(pending.timeout); pendingRef.current.delete(chunk.requestId); pending.reject(new Error("The relay sent an incomplete delta transfer.")); return
            }
            if (!pending.verifiedMessageIds.has(id) && await canonicalJsonFingerprint(canonicalMessageValue(jsonValue(message))) !== fingerprint) {
              window.clearTimeout(pending.timeout); pendingRef.current.delete(chunk.requestId); pending.reject(new Error("The relay sent an invalid delta transfer.")); return
            }
            if (pendingRef.current.get(chunk.requestId) !== pending || pending.generation !== socketGenerationRef.current) return
            pending.verifiedMessageIds.add(id)
          }
          if (pending.completionScheduled) return
          pending.completionScheduled = true
          void pending.progressChain.then(() => {
            if (pendingRef.current.get(chunk.requestId) !== pending || pending.generation !== socketGenerationRef.current) return
            window.clearTimeout(pending.timeout)
            pendingRef.current.delete(chunk.requestId)
            pending.resolve({ deltaManifest: pending.deltaManifest, messages })
          }).catch((cause) => {
            if (pendingRef.current.get(chunk.requestId) !== pending) return
            window.clearTimeout(pending.timeout)
            pendingRef.current.delete(chunk.requestId)
            pending.reject(cause instanceof Error ? cause : new Error(String(cause)))
          })
        }
      } else if (data.type === "rpc.result") {
        const pending = pendingRef.current.get(data.requestId)
        if (!pending) return
        if (pending.relayId !== frame.sender) {
          console.warn("Ignored unmatched encrypted RPC response", {
            requestId: data.requestId,
            relayId: frame.sender,
            pendingRelayId: pending?.relayId,
          })
          return
        }
        if (pending.command.type === "session.messages" &&
          validManifest(data.result)) {
          const manifest = validManifest(data.result)!
          if (!legacyManifestCompatible(pending.chunks, manifest.total)) {
            window.clearTimeout(pending.timeout)
            pendingRef.current.delete(data.requestId)
            pending.reject(new Error("The relay sent an incompatible message manifest."))
            return
          }
          pending.manifestIds = manifest.ids
          pending.chunks.total = manifest.total
          window.clearTimeout(pending.timeout)
          pending.timeout = window.setTimeout(() => { pendingRef.current.delete(data.requestId); pending.reject(new Error("The relay stopped sending messages.")) }, requestInactivityMs(pending.command.type))
          const state = legacyChunkState(pending.chunks, pending.manifestIds, pending.verifiedMessageIds)
          const isActive = () => pendingRef.current.get(data.requestId) === pending && pending.generation === socketGenerationRef.current
          queueProgressSnapshot(pending, state.progress, isActive, (cause) => {
            if (!isActive()) return
            window.clearTimeout(pending.timeout)
            pendingRef.current.delete(data.requestId)
            pending.reject(cause instanceof Error ? cause : new Error(String(cause)))
          })
          if (!state.complete) return
          if (!state.messages) {
            window.clearTimeout(pending.timeout)
            pendingRef.current.delete(data.requestId)
            pending.reject(new Error("The relay sent an incomplete message transfer."))
            return
          }
          if (pending.completionScheduled) return
          pending.completionScheduled = true
          void pending.progressChain.then(() => {
            if (pendingRef.current.get(data.requestId) !== pending || pending.generation !== socketGenerationRef.current) return
            window.clearTimeout(pending.timeout)
            pendingRef.current.delete(data.requestId)
            pending.resolve(state.messages)
          }).catch((cause) => {
            if (pendingRef.current.get(data.requestId) !== pending) return
            window.clearTimeout(pending.timeout)
            pendingRef.current.delete(data.requestId)
            pending.reject(cause instanceof Error ? cause : new Error(String(cause)))
          })
          return
        }
        window.clearTimeout(pending.timeout)
        pendingRef.current.delete(data.requestId)
        if (pending.command.type === "relay.ping") {
          const rtt = Date.now() - pending.startedAt
          setRelayHealth((current) => ({ ...current, [frame.sender]: { ...current[frame.sender], lastContact: Date.now(), rtt, timedOut: false } }))
        }
        if (data.error) pending.reject(new Error(data.error))
        else pending.resolve(data.result)
      } else if (data.type === "rpc.chunk") {
        const pending = pendingRef.current.get(data.requestId)
        if (!pending || pending.relayId !== frame.sender) return
        if (data.error) {
          window.clearTimeout(pending.timeout)
          pendingRef.current.delete(data.requestId)
          pending.reject(new Error(data.error))
          return
        }
        if (!addChunk(pending.chunks, data)) return
        window.clearTimeout(pending.timeout)
        pending.timeout = window.setTimeout(() => { pendingRef.current.delete(data.requestId); pending.reject(new Error("The relay stopped sending messages.")) }, requestInactivityMs(pending.command.type))
        const partial = assembledMessages(pending.chunks)
        for (const message of partial) {
          const id = (message as { info?: { id?: unknown } }).info?.id
          if (typeof id === "string" && id) pending.verifiedMessageIds.add(id)
        }
        const state = legacyChunkState(pending.chunks, pending.manifestIds, pending.verifiedMessageIds)
        const isActive = () => pendingRef.current.get(data.requestId) === pending && pending.generation === socketGenerationRef.current
        queueProgressSnapshot(pending, state.progress, isActive, (cause) => {
          if (!isActive()) return
          window.clearTimeout(pending.timeout)
          pendingRef.current.delete(data.requestId)
          pending.reject(cause instanceof Error ? cause : new Error(String(cause)))
        })
        if (state.complete) {
          if (!state.messages) { window.clearTimeout(pending.timeout); pendingRef.current.delete(data.requestId); pending.reject(new Error("The relay sent an incomplete message transfer.")); return }
          if (pending.completionScheduled) return
          pending.completionScheduled = true
          void pending.progressChain.then(() => {
            if (pendingRef.current.get(data.requestId) !== pending || pending.generation !== socketGenerationRef.current) return
            window.clearTimeout(pending.timeout)
            pendingRef.current.delete(data.requestId)
            pending.resolve(state.messages)
          }).catch((cause) => {
            if (pendingRef.current.get(data.requestId) !== pending) return
            window.clearTimeout(pending.timeout)
            pendingRef.current.delete(data.requestId)
            pending.reject(cause instanceof Error ? cause : new Error(String(cause)))
          })
        }
      }
    } catch (cause) {
      console.warn("Rejected encrypted relay frame", cause)
      return
    }
  }, [applyEvent, publishSlices, rememberMessage, requestSnapshots, sendCommandFrame])

  const retireTransport = useCallback((message: string) => {
    const socket = socketRef.current
    if (!socket) return
    const generation = socketGenerationRef.current
    socketRef.current = undefined
    authenticatedRef.current = false
    for (const [requestId, pending] of pendingRef.current) {
      if (pending.generation !== generation) continue
      window.clearTimeout(pending.timeout)
      pending.reject(new Error(message))
      pendingRef.current.delete(requestId)
    }
    connectedRelaysRef.current.clear()
    recoveryInFlightRef.current.clear()
    snapshotInvalidationRef.current.clear()
    setRelayHealth({})
    setServiceConnected(false)
    publishSlices()
    socket.close(1000, "Connection replaced")
  }, [publishSlices])

  const connectIdentity = useCallback((identity: DeviceIdentity) => {
    retireTransport("Connection interrupted")
    const epoch = ++connectionEpochRef.current
    identityRef.current = identity
    setEnrolled(identity.enrolled)
    setConnection("connecting")
    lastTransportActivityRef.current = Date.now()
    const open = () => {
      if (connectionEpochRef.current !== epoch) return
      const broker = new URL(identity.brokerUrl)
      broker.searchParams.set("role", "client")
      const socket = new WebSocket(broker, ["remotty", identity.roomToken])
      socketRef.current = socket
      const generation = ++socketGenerationRef.current
      authenticatedRef.current = false
      lastTransportActivityRef.current = Date.now()
      let enrollmentSent = false
      let helloStarted = false
      let encryptedFrameQueue: Promise<void> = Promise.resolve()
      const handshakeWatchdog = window.setTimeout(() => {
        if (socketRef.current !== socket || connectionEpochRef.current !== epoch ||
          !shouldExpireHandshakeWatchdog(generation, socketGenerationRef.current, authenticatedRef.current)) return
        setError("Connection handshake timed out.")
        socket.close(4000, "Connection handshake timed out")
      }, HANDSHAKE_TIMEOUT_MS)

      const enroll = async () => {
        const current = identityRef.current
        if (!current || current.enrolled || enrollmentSent) return
        if (!current.inviteId || !current.inviteSecret) throw new Error("This device has no active encrypted invite.")
        enrollmentSent = true
        const frame = await sealEnrollmentPayload({
          type: "device.enroll",
          inviteId: current.inviteId,
          inviteSecret: current.inviteSecret,
          device: {
            id: current.deviceId,
            name: current.name,
            signingPublicKey: current.signingPublicKey,
            encryptionPublicKey: current.encryptionPublicKey,
          },
        }, {
          sender: current.deviceId,
          recipient: "*",
          messageId: crypto.randomUUID(),
          issuedAt: Date.now(),
          signingPrivateKey: current.signingPrivateKey,
          senderEncryptionPrivateKey: current.encryptionPrivateKey,
          senderEncryptionPublicKey: current.encryptionPublicKey,
          recipientEncryptionPublicKey: current.relayEncryptionKey,
        })
        if (socketRef.current === socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame))
      }

      socket.addEventListener("open", () => {
        if (socketRef.current === socket && connectionEpochRef.current === epoch) lastTransportActivityRef.current = Date.now()
      })
      socket.addEventListener("message", (message) => {
        if (socketRef.current !== socket) return
        lastTransportActivityRef.current = Date.now()
        let value: unknown
        try {
          value = JSON.parse(String(message.data))
        } catch {
          return
        }
        const control = brokerTransportControlSchema.safeParse(value)
        if (control.success) {
          if (control.data.type === "broker.challenge" && !helloStarted) {
            helloStarted = true
            const challenge = control.data.nonce
            void signCanonicalJson(
              transportProofPayload("client", identity.deviceId, identity.roomToken, challenge),
              identity.signingPrivateKey,
            ).then((signature) => {
              if (socketRef.current !== socket || socket.readyState !== WebSocket.OPEN) return
              socket.send(JSON.stringify({
                type: "transport.hello",
                version: 2,
                role: "client",
                deviceId: identity.deviceId,
                publicKey: identity.signingPublicKey,
                signature,
              }))
            }).catch((cause) => setError((cause as Error).message))
          } else if (control.data.type === "broker.ready") {
            authenticatedRef.current = true
            window.clearTimeout(handshakeWatchdog)
            lastTransportActivityRef.current = Date.now()
            setError((current) => current === "Connection handshake timed out." || current === "Cannot reach the relay broker." ? undefined : current)
            setServiceConnected(true)
            reconnectAttemptRef.current = 0
            connectedRelaysRef.current = new Set(control.data.connectedRelayIds)
            publishSlices()
            setConnection(control.data.connectedRelayIds.length ? "online" : "offline")
            const current = identityRef.current
            if (current?.enrolled) {
              void requestSnapshots(current, connectedRelaysRef.current).catch(() => undefined)
              if (localStorage.getItem("remotty-notifications") === "enabled") {
                void registerPush(current).catch((cause) => setError((cause as Error).message))
              }
              if (control.data.connectedRelayIds.length) {
                window.setTimeout(() => {
                  if (connectionEpochRef.current !== epoch || !identityRef.current?.enrolled) return
                  if (!connectedRelaysRef.current.size || slicesRef.current.size) return
                  setError("No workspace answered this device. If it was revoked, disconnect and pair it again.")
                }, 15_000)
              }
            }
            else if (control.data.connectedRelayIds.length) void enroll().catch((cause) => setError((cause as Error).message))
            else setError("No OpenCode workspace is connected. On your computer run `opencode plugin opencode-remotty --global --force`, quit OpenCode, then run `opencode --continue` and keep this page open. Pairing resumes automatically.")
          } else if (control.data.type === "broker.relay-status") {
            if (control.data.connected) {
              connectedRelaysRef.current.add(control.data.relayId)
              publishSlices()
            }
            else {
              const relayId = control.data.relayId
              connectedRelaysRef.current.delete(relayId)
              recoveryInFlightRef.current.delete(relayId)
              setRelayHealth((current) => { const next = { ...current }; delete next[relayId]; return next })
              publishSlices()
              for (const [requestId, pending] of pendingRef.current) {
                if (pending.relayId !== control.data.relayId) continue
                window.clearTimeout(pending.timeout)
                pending.reject(new Error("The workspace relay disconnected."))
                pendingRef.current.delete(requestId)
              }
            }
            setConnection(connectedRelaysRef.current.size ? "online" : "offline")
            const current = identityRef.current
            if (control.data.connected && current?.enrolled) {
              void requestSnapshots(current, [control.data.relayId]).catch(() => undefined)
            } else if (control.data.connected) {
              setError(undefined)
              void enroll().catch((cause) => setError((cause as Error).message))
            }
          } else if (control.data.type === "broker.error") {
            setError(`Broker transport error (${control.data.code}).`)
          }
          return
        }
        encryptedFrameQueue = encryptedFrameQueue.catch(() => undefined).then(async () => {
          if (socketRef.current === socket && connectionEpochRef.current === epoch) await handleEncryptedFrame(value, epoch)
        })
      })
      socket.addEventListener("error", () => {
        if (socketRef.current === socket) setError("Cannot reach the relay broker.")
      })
      socket.addEventListener("close", (event) => {
        window.clearTimeout(handshakeWatchdog)
        if (socketRef.current !== socket || connectionEpochRef.current !== epoch) return
        if (event.code === 4001) {
          for (const [requestId, pending] of pendingRef.current) {
            if (pending.generation !== generation) continue
            window.clearTimeout(pending.timeout)
            pending.reject(new Error("This device was opened in another Remotty window."))
            pendingRef.current.delete(requestId)
          }
          connectedRelaysRef.current.clear()
          recoveryInFlightRef.current.clear()
          snapshotInvalidationRef.current.clear()
          setServiceConnected(false)
          setRelayHealth({})
          publishSlices()
          setConnection("offline")
          setError("This device was opened in another Remotty window.")
          return
        }
        for (const [requestId, pending] of pendingRef.current) {
          if (pending.generation !== generation) continue
          window.clearTimeout(pending.timeout)
          pending.reject(new Error("Connection interrupted"))
          pendingRef.current.delete(requestId)
        }
        connectedRelaysRef.current.clear()
        recoveryInFlightRef.current.clear()
        setRelayHealth({})
        setServiceConnected(false)
        publishSlices()
        setConnection("connecting")
        window.setTimeout(open, reconnectDelay(reconnectAttemptRef.current++))
      })
    }
    open()
  }, [handleEncryptedFrame, publishSlices, requestSnapshots, retireTransport])

  const connect = useCallback(async (bundle: PairingBundle) => {
    try {
      await cleanupRef.current
      const identity = await prepareIdentity(bundle)
      connectIdentity(identity)
    } catch (cause) {
      setConnection("disconnected")
      setEnrolled(false)
      setError((cause as Error).message)
    }
  }, [connectIdentity])

  const disconnect = useCallback(() => {
    ++connectionEpochRef.current
    const identity = identityRef.current
    identityRef.current = undefined
    socketRef.current?.close(1000, "Client disconnected")
    socketRef.current = undefined
    for (const pending of pendingRef.current.values()) {
      window.clearTimeout(pending.timeout)
      pending.reject(new Error("Client disconnected"))
    }
    pendingRef.current.clear()
    connectedRelaysRef.current.clear()
    snapshotInvalidationRef.current.clear()
    slicesRef.current.clear()
    sessionRelaysRef.current.clear()
    retainedSessionState.clear()
    setSessionRevisions({})
    setResourceRevisions({})
    publishSlices()
    setConnection("disconnected")
    setServiceConnected(false)
    setEnrolled(false)
    setNotificationsEnabled(false)
    localStorage.removeItem("remotty-notifications")
    cleanupRef.current = (async () => {
      if (identity) await unregisterPush(identity)
      if (identity) await deleteIdentity(identity)
    })().catch(() => undefined)
  }, [publishSlices])

  const request = useCallback(async (command: RelayRequest, workspaceRelayId?: string, progress?: (messages: unknown[], isActive: () => boolean) => void | Promise<void>): Promise<unknown> => {
    const identity = identityRef.current
    if (!identity?.enrolled) throw new Error("The browser device is not enrolled.")
    if (command.type === "snapshot.request") {
      return requestSnapshots(identity, connectedRelaysRef.current, true)
    }
    const initialRelayId = workspaceRelayId ?? commandRelayId(command, connectedRelaysRef.current, sessionRelaysRef.current)
    if (!initialRelayId) throw new Error("Cannot determine the workspace relay for this command.")
    const initialSlice = slicesRef.current.get(initialRelayId)
    const workspaceKey = initialSlice ? stableWorkspaceKey(initialSlice.relay) : undefined
    const deadline = Date.now() + 60_000
    for (let attempts = 0; ; attempts += 1) {
       const relayId = workspaceKey ? resolveConnectedWorkspaceRelay(workspaceKey, connectedRelaysRef.current, slicesRef.current) : initialRelayId
       if (!relayId) {
         if (!readOnlyCommand(command.type) || Date.now() >= deadline) throw new Error("The workspace relay disconnected.")
         await new Promise((resolve) => window.setTimeout(resolve, 100))
         continue
       }
       const relay = slicesRef.current.get(relayId)?.relay
       const compatibleCommand = commandForRelayCapabilities(command, relay?.capabilities)
       try {
         const result = await requestFromRelay(identity, relayId, compatibleCommand, progress)
          return command.type === "session.prompt" && !relay?.capabilities?.relayPromptMessageId ? { promptMessageId: false, result } : result
       } catch (error) {
        if (!readOnlyCommand(command.type) || !retryPlan(Date.now(), deadline, attempts)) throw error
         while (Date.now() < deadline && (!authenticatedRef.current || !(workspaceKey ? resolveConnectedWorkspaceRelay(workspaceKey, connectedRelaysRef.current, slicesRef.current) : connectedRelaysRef.current.has(relayId)))) {
          await new Promise((resolve) => window.setTimeout(resolve, 100))
        }
        if (Date.now() >= deadline) throw error
      }
    }
  }, [requestFromRelay, requestSnapshots])

  const toggleNotifications = useCallback(async () => {
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setError("This browser does not support PWA notifications.")
      return
    }
    const identity = identityRef.current
    if (!identity?.enrolled) {
      setError("Connect and enroll this browser before enabling notifications.")
      return
    }
    try {
      if (notificationsEnabled) {
        await unregisterPush(identity)
        localStorage.removeItem("remotty-notifications")
        setNotificationsEnabled(false)
        return
      }
      const permission = await Notification.requestPermission()
      if (permission !== "granted") throw new Error("Notification permission was not granted.")
      await registerPush(identity)
      localStorage.setItem("remotty-notifications", "enabled")
      setNotificationsEnabled(true)
    } catch (cause) {
      setError((cause as Error).message)
    }
  }, [notificationsEnabled])

  const isRelayConnected = useCallback((relayId: string) => connectedRelaysRef.current.has(relayId), [])
  const loadCache = useCallback(<T,>(relayId: string, resource: string, sessionId?: string) => {
    const identity = identityRef.current
    return identity ? loadCachedResource<T>(identity, cacheNamespace(relayId, slicesRef.current.get(relayId)?.relay), resource, sessionId) : Promise.resolve(undefined)
  }, [])
  const saveCache = useCallback(<T,>(relayId: string, resource: string, value: T, sessionId?: string) => {
    const identity = identityRef.current
    return identity ? saveCachedResource(identity, cacheNamespace(relayId, slicesRef.current.get(relayId)?.relay), resource, value, sessionId) : Promise.resolve()
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (initialBundle) {
        const identity = await prepareIdentity(initialBundle)
        if (!cancelled) connectIdentity(identity)
        return
      }
      const identity = await loadCurrentIdentity()
      if (cancelled) return
      if (identity) {
        const cached = await loadCachedResources<RelaySlice>(identity, "snapshot")
        if (!cancelled) {
          for (const record of cached) slicesRef.current.set(record.value.relay.id, normalizeRelaySlice(record.value))
          publishSlices()
          connectIdentity(identity)
        }
      }
      else {
        setConnection("disconnected")
        setEnrolled(false)
      }
    })().catch((cause) => {
      if (!cancelled) {
        setConnection("disconnected")
        setEnrolled(false)
        setError((cause as Error).message)
      }
    })
    return () => {
      cancelled = true
      ++connectionEpochRef.current
      const socket = socketRef.current
      socketRef.current = undefined
      socket?.close(1000, "Page closed")
    }
  }, [connect, connectIdentity, initialBundle, publishSlices])

  useEffect(() => {
    const reconnect = (options: { persisted?: boolean; online?: boolean } = {}) => {
      const identity = identityRef.current
      const now = Date.now()
      const socket = socketRef.current
      const socketOpen = socket?.readyState === WebSocket.OPEN
      const socketConnecting = socket?.readyState === WebSocket.CONNECTING
      if (!identity || !shouldReconnectTransportOnResume(socketConnecting, { socketOpen, now, hiddenAt: hiddenAtRef.current, lastTransportActivity: lastTransportActivityRef.current, ...options })) return
      if (now - lastRecoveryAtRef.current < 1_000) return
      lastRecoveryAtRef.current = now
      connectIdentity(identity)
      hiddenAtRef.current = undefined
    }
    const online = () => reconnect({ online: true })
    const pageShow = (event: PageTransitionEvent) => reconnect({ persisted: event.persisted })
    const visibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAtRef.current = Date.now()
        return
      }
      reconnect()
      hiddenAtRef.current = undefined
    }
    window.addEventListener("online", online)
    window.addEventListener("pageshow", pageShow)
    document.addEventListener("visibilitychange", visibility)
    return () => { window.removeEventListener("online", online); window.removeEventListener("pageshow", pageShow); document.removeEventListener("visibilitychange", visibility) }
  }, [connectIdentity])

  useEffect(() => {
    const ping = () => {
      const identity = identityRef.current
      if (!identity?.enrolled || document.visibilityState !== "visible") return
      for (const relayId of connectedRelaysRef.current) {
        if (!slicesRef.current.get(relayId)?.relay.capabilities?.ping) continue
        const generation = socketGenerationRef.current
        void requestFromRelay(identity, relayId, { type: "relay.ping", sentAt: Date.now() }).then(() => {
          setRelayHealth((current) => {
            const next = { ...current, [relayId]: { ...current[relayId], failures: 0, timedOut: false } }
            if (!healthSummary(connectedRelaysRef.current, next)) setConnection("online")
            return next
          })
        }).catch(() => {
          if (socketGenerationRef.current !== generation) return
          setRelayHealth((current) => {
            const failures = (current[relayId]?.failures ?? 0) + 1
            const next = { ...current, [relayId]: { ...current[relayId], failures, timedOut: true } }
            setConnection("unstable")
            if (failures >= 2) socketRef.current?.close(4000, "Health check timed out")
            return next
          })
        })
      }
    }
    const timer = window.setInterval(ping, 20_000)
    ping()
    return () => window.clearInterval(timer)
  }, [requestFromRelay])

  return {
    connection,
    enrolled,
    relay,
    relays,
    sessions,
    agents,
    permissions,
    questions,
    subagents,
    subagentsByRoot,
    sessionRevisions,
    resourceRevisions,
    notificationsEnabled,
    error,
    serviceConnected,
    relayHealth,
    lastSyncedAt,
    connect,
    disconnect,
    request,
    toggleNotifications,
    setError,
    isRelayConnected,
    loadCache,
    saveCache,
  }
}
