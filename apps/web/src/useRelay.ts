import { useCallback, useEffect, useRef, useState } from "react"
import {
  brokerTransportControlSchema,
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
} from "@remotty/protocol"
import { currentDeviceName } from "./deviceName"
import {
  deleteIdentity,
  loadCurrentIdentity,
  markIdentityEnrolled,
  prepareIdentity,
  setCurrentIdentity,
  type DeviceIdentity,
} from "./deviceStore"
import { acceptsRelayPosition, aggregateRelaySlices, commandRelayId, type RelaySlice } from "./relayState"

type PendingRequest = {
  relayId: string
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timeout: number
}

type RelayRequest = ClientCommand extends infer Command
  ? Command extends { requestId: string } ? Omit<Command, "requestId"> : never
  : never

const MAX_FRAME_AGE_MS = 5 * 60 * 1_000
const MAX_RECENT_MESSAGES = 1_000

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
    body: JSON.stringify(await signedPushRequest(identity, "subscribe", { subscription: subscription.toJSON() })),
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
  const [connection, setConnection] = useState<"disconnected" | "connecting" | "online" | "offline">("connecting")
  const [enrolled, setEnrolled] = useState<boolean>()
  const [relay, setRelay] = useState<ReturnType<typeof aggregateRelaySlices>["relay"]>()
  const [relays, setRelays] = useState<ReturnType<typeof aggregateRelaySlices>["relays"]>([])
  const [sessions, setSessions] = useState<ReturnType<typeof aggregateRelaySlices>["sessions"]>([])
  const [agents, setAgents] = useState<ReturnType<typeof aggregateRelaySlices>["agents"]>([])
  const [permissions, setPermissions] = useState<ReturnType<typeof aggregateRelaySlices>["permissions"]>([])
  const [questions, setQuestions] = useState<ReturnType<typeof aggregateRelaySlices>["questions"]>([])
  const [sessionRevisions, setSessionRevisions] = useState<Record<string, number>>({})
  const [notificationsEnabled, setNotificationsEnabled] = useState(
    () => localStorage.getItem("remotty-notifications") === "enabled" &&
      typeof Notification !== "undefined" && Notification.permission === "granted",
  )
  const [error, setError] = useState<string>()
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

  const publishSlices = useCallback(() => {
    const state = aggregateRelaySlices(slicesRef.current)
    sessionRelaysRef.current = state.sessionRelays
    setRelay(state.relay)
    setRelays(state.relays)
    setSessions(state.sessions)
    setAgents(state.agents)
    setPermissions(state.permissions)
    setQuestions(state.questions)
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

  const requestFromRelay = useCallback((identity: DeviceIdentity, relayId: string, command: RelayRequest) => {
    if (!connectedRelaysRef.current.has(relayId)) return Promise.reject(new Error("The workspace relay is offline."))
    const requestId = crypto.randomUUID()
    return new Promise<unknown>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        pendingRef.current.delete(requestId)
        reject(new Error("The relay did not respond."))
      }, 30_000)
      pendingRef.current.set(requestId, { relayId, resolve, reject, timeout })
      void sendCommandFrame(identity, relayId, { ...command, requestId } as ClientCommand).catch((cause) => {
        window.clearTimeout(timeout)
        pendingRef.current.delete(requestId)
        reject(cause)
      })
    })
  }, [sendCommandFrame])

  const requestSnapshots = useCallback((identity: DeviceIdentity, relayIds: Iterable<string>, waitForReply = false) => {
    const deviceName = currentDeviceName(identity.deviceId)
    const requests = [...relayIds].map((relayId) => {
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
    slice.sequence = sequence
    const properties = event.properties as Record<string, unknown>
    const info = properties.info as Record<string, unknown> | undefined
    const part = properties.part as Record<string, unknown> | undefined
    const sessionID = String(properties.sessionID ?? info?.sessionID ?? part?.sessionID ?? "")
    if (sessionID && ["message.updated", "message.part.updated", "message.part.delta", "session.diff", "todo.updated"].includes(event.type)) {
      const revisionKey = `${relayId}:${sessionID}`
      setSessionRevisions((current) => ({ ...current, [revisionKey]: (current[revisionKey] ?? 0) + 1 }))
    }
    if (["session.status", "session.idle", "session.error"].includes(event.type)) {
      const status = event.type === "session.idle" ? "idle" : event.type === "session.error" ? "error"
        : (properties.status as { type?: SessionSummary["status"] })?.type
      slice.sessions = slice.sessions.map((session) => session.id === sessionID && status ? { ...session, status } : session)
    }
    if (["permission.updated", "permission.asked"].includes(event.type)) {
      const parsed = permissionRequestSchema.safeParse(properties)
      if (parsed.success) slice.permissions = [...slice.permissions.filter((item) => item.id !== parsed.data.id), parsed.data]
    }
    if (event.type === "permission.replied") {
      const permissionId = String(properties.requestID ?? properties.permissionID ?? "")
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
    publishSlices()
  }, [publishSlices])

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
          relay: data.relay, sessions: [], agents: [], permissions: [], questions: [], sequence: data.sequence,
        })
        slicesRef.current.get(frame.sender)!.sequence = data.sequence
        publishSlices()
      } else if (data.type === "relay.snapshot") {
        if (data.relay.id !== frame.sender) return
        const current = slicesRef.current.get(frame.sender)
        if (!acceptsRelayPosition(current, data.relay, data.sequence)) return
        slicesRef.current.set(frame.sender, {
          relay: data.relay,
          sessions: data.sessions,
          agents: data.agents,
          permissions: data.permissions,
          questions: data.questions,
          sequence: data.sequence,
        })
        publishSlices()
      } else if (data.type === "relay.event") {
        applyEvent(frame.sender, data.event, data.instanceId, data.sequence)
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
        window.clearTimeout(pending.timeout)
        pendingRef.current.delete(data.requestId)
        if (data.error) pending.reject(new Error(data.error))
        else pending.resolve(data.result)
      }
    } catch (cause) {
      console.warn("Rejected encrypted relay frame", cause)
      return
    }
  }, [applyEvent, publishSlices, rememberMessage, requestSnapshots, sendCommandFrame])

  const connectIdentity = useCallback((identity: DeviceIdentity) => {
    const epoch = ++connectionEpochRef.current
    identityRef.current = identity
    setEnrolled(identity.enrolled)
    socketRef.current?.close(1000, "Connection replaced")
    setConnection("connecting")
    setError(undefined)
    const open = () => {
      if (connectionEpochRef.current !== epoch) return
      const broker = new URL(identity.brokerUrl)
      broker.searchParams.set("role", "client")
      const socket = new WebSocket(broker, ["remotty", identity.roomToken])
      socketRef.current = socket
      let enrollmentSent = false
      let helloStarted = false

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

      socket.addEventListener("message", (message) => {
        if (socketRef.current !== socket) return
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
            connectedRelaysRef.current = new Set(control.data.connectedRelayIds)
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
            else setError("No OpenCode workspace is connected. On your computer run `opencode plugin opencode-remotty --global --force`, restart OpenCode, and keep this page open. Pairing resumes automatically.")
          } else if (control.data.type === "broker.relay-status") {
            if (control.data.connected) connectedRelaysRef.current.add(control.data.relayId)
            else {
              connectedRelaysRef.current.delete(control.data.relayId)
              slicesRef.current.delete(control.data.relayId)
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
        void handleEncryptedFrame(value, epoch)
      })
      socket.addEventListener("error", () => {
        if (socketRef.current === socket) setError("Cannot reach the relay broker.")
      })
      socket.addEventListener("close", (event) => {
        if (socketRef.current !== socket || connectionEpochRef.current !== epoch) return
        if (event.code === 4001) {
          setConnection("offline")
          setError("This device was opened in another Remotty window.")
          return
        }
        setConnection("connecting")
        window.setTimeout(open, 1_000)
      })
    }
    open()
  }, [handleEncryptedFrame, publishSlices, requestSnapshots])

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
    slicesRef.current.clear()
    sessionRelaysRef.current.clear()
    publishSlices()
    setConnection("disconnected")
    setEnrolled(false)
    setNotificationsEnabled(false)
    localStorage.removeItem("remotty-notifications")
    cleanupRef.current = (async () => {
      if (identity) await unregisterPush(identity)
      if (identity) await deleteIdentity(identity)
    })().catch(() => undefined)
  }, [publishSlices])

  const request = useCallback((command: RelayRequest, workspaceRelayId?: string): Promise<unknown> => {
    const identity = identityRef.current
    if (!identity?.enrolled) return Promise.reject(new Error("The browser device is not enrolled."))
    if (command.type === "snapshot.request") {
      return requestSnapshots(identity, connectedRelaysRef.current, true)
    }
    const relayId = workspaceRelayId ?? commandRelayId(command, connectedRelaysRef.current, sessionRelaysRef.current)
    if (!relayId) return Promise.reject(new Error("Cannot determine the workspace relay for this command."))
    return requestFromRelay(identity, relayId, command)
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
      if (identity) connectIdentity(identity)
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
  }, [connect, connectIdentity, initialBundle])

  return {
    connection,
    enrolled,
    relay,
    relays,
    sessions,
    agents,
    permissions,
    questions,
    sessionRevisions,
    notificationsEnabled,
    error,
    connect,
    disconnect,
    request,
    toggleNotifications,
    setError,
    isRelayConnected,
  }
}
