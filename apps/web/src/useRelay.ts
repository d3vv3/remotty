import { useCallback, useEffect, useRef, useState } from "react"
import {
  brokerMessageSchema,
  permissionRequestSchema,
  relayMessageSchema,
  type AgentSummary,
  type ClientCommand,
  type PermissionRequest,
  type QuestionRequest,
  type RelayInfo,
  type SessionSummary,
} from "@remotty/protocol"

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timeout: number
}

const defaultBrokerUrl = () => {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:"
  return `${protocol}//${location.hostname}:8787/ws`
}

const brokerUrl = () => new URL(import.meta.env.VITE_REMOTTY_URL ?? import.meta.env.VITE_RELAY_URL ?? defaultBrokerUrl())

const brokerHttpUrl = () => {
  const url = brokerUrl()
  url.protocol = url.protocol === "wss:" ? "https:" : "http:"
  url.pathname = "/"
  url.search = ""
  return url
}

const applicationServerKey = (value: string) => {
  const padding = "=".repeat((4 - (value.length % 4)) % 4)
  const bytes = atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"))
  return Uint8Array.from(bytes, (character) => character.charCodeAt(0))
}

const registerPush = async (code: string) => {
  const registration = await navigator.serviceWorker.ready
  const { publicKey } = (await fetch(new URL("push/public-key", brokerHttpUrl())).then((response) =>
    response.json(),
  )) as { publicKey: string }
  const key = applicationServerKey(publicKey)
  const existing = await registration.pushManager.getSubscription()
  const existingKey = existing?.options.applicationServerKey
    ? new Uint8Array(existing.options.applicationServerKey)
    : undefined
  const keyChanged = existingKey &&
    (existingKey.length !== key.length || existingKey.some((byte, index) => byte !== key[index]))
  if (keyChanged) await existing?.unsubscribe()
  const subscription =
    !keyChanged && existing
      ? existing
      : await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
  const response = await fetch(new URL("push/subscribe", brokerHttpUrl()), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, brokerUrl: brokerHttpUrl().origin, subscription: subscription.toJSON() }),
  })
  if (!response.ok) throw new Error("The broker rejected the Push subscription.")
}

export function useRelay() {
  const storedCredential = () => {
    const current = localStorage.getItem("remotty-credential")
    if (current) return current
    const legacy = localStorage.getItem("opencode-relay-code")
    if (legacy) localStorage.setItem("remotty-credential", legacy)
    return legacy
  }
  const [connection, setConnection] = useState<"disconnected" | "connecting" | "online" | "offline">(
    "disconnected",
  )
  const [relay, setRelay] = useState<RelayInfo>()
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [agents, setAgents] = useState<AgentSummary[]>([])
  const [permissions, setPermissions] = useState<PermissionRequest[]>([])
  const [questions, setQuestions] = useState<QuestionRequest[]>([])
  const [sessionRevisions, setSessionRevisions] = useState<Record<string, number>>({})
  const [notificationsEnabled, setNotificationsEnabled] = useState(
    () =>
      (localStorage.getItem("remotty-notifications") ?? localStorage.getItem("opencode-relay-notifications")) === "enabled" &&
      typeof Notification !== "undefined" &&
      Notification.permission === "granted",
  )
  const [error, setError] = useState<string>()
  const socketRef = useRef<WebSocket | undefined>(undefined)
  const pendingRef = useRef(new Map<string, PendingRequest>())

  const disconnect = useCallback(() => {
    socketRef.current?.close(1000, "Client disconnected")
    socketRef.current = undefined
    setConnection("disconnected")
    setRelay(undefined)
    setSessions([])
    setAgents([])
    setPermissions([])
    setQuestions([])
    localStorage.removeItem("remotty-credential")
    localStorage.removeItem("opencode-relay-code")
  }, [])

  const connect = useCallback(function open(inputCode: string) {
    const code = inputCode.trim()
    if (!code.match(/^[A-Za-z0-9_-]{32,128}$/)) {
      setError("Enter the 256-bit pairing key from the relay.")
      localStorage.removeItem("remotty-credential")
      localStorage.removeItem("opencode-relay-code")
      setConnection("disconnected")
      setRelay(undefined)
      setSessions([])
      return
    }

    socketRef.current?.close()
    setConnection("connecting")
    setError(undefined)
    localStorage.setItem("remotty-credential", code)
    const broker = brokerUrl()
    broker.searchParams.set("role", "client")
    const socket = new WebSocket(broker, ["remotty", code])
    socketRef.current = socket

    socket.addEventListener("open", () => {
      if (socketRef.current === socket) setConnection("offline")
      if ((localStorage.getItem("remotty-notifications") ?? localStorage.getItem("opencode-relay-notifications")) === "enabled") {
        void registerPush(code).catch((error) => setError((error as Error).message))
      }
    })
    socket.addEventListener("close", () => {
      if (socketRef.current !== socket) return
      setConnection("connecting")
      window.setTimeout(() => {
        if (socketRef.current === socket) open(code)
      }, 1_000)
    })
    socket.addEventListener("error", () => {
      if (socketRef.current === socket) setError("Cannot reach the relay broker.")
    })
    socket.addEventListener("message", (message) => {
      if (socketRef.current !== socket) return
      let value: unknown
      try {
        value = JSON.parse(String(message.data))
      } catch {
        return
      }

      const brokerMessage = brokerMessageSchema.safeParse(value)
      if (brokerMessage.success) {
        if (brokerMessage.data.type === "broker.ready") {
          setConnection(brokerMessage.data.relayConnected ? "online" : "offline")
        } else if (brokerMessage.data.type === "broker.relay-status") {
          setConnection(brokerMessage.data.connected ? "online" : "offline")
        } else {
          setError(brokerMessage.data.message)
        }
        return
      }

      const relayMessage = relayMessageSchema.safeParse(value)
      if (!relayMessage.success) {
        console.warn("Rejected relay message", relayMessage.error.issues)
        return
      }
      const data = relayMessage.data
      if (data.type === "relay.hello") {
        setRelay(data.relay)
        setConnection("online")
      } else if (data.type === "relay.snapshot") {
        setRelay(data.relay)
        setSessions(data.sessions.sort((a, b) => b.updatedAt - a.updatedAt))
        setAgents(data.agents)
        setPermissions(data.permissions)
        setQuestions(data.questions)
        setConnection("online")
      } else if (data.type === "relay.event") {
        applyEvent(data.event)
      } else if (data.type === "rpc.result") {
        const pending = pendingRef.current.get(data.requestId)
        if (!pending) return
        clearTimeout(pending.timeout)
        pendingRef.current.delete(data.requestId)
        if (data.error) pending.reject(new Error(data.error))
        else pending.resolve(data.result)
      }
    })
  }, [])

  const applyEvent = (event: { type: string; properties: unknown }) => {
    const properties = event.properties as Record<string, unknown>
    const info = properties.info as Record<string, unknown> | undefined
    const part = properties.part as Record<string, unknown> | undefined
    const sessionID = String(properties.sessionID ?? info?.sessionID ?? part?.sessionID ?? "")
    if (
      sessionID &&
      ["message.updated", "message.part.updated", "message.part.delta", "session.diff", "todo.updated"].includes(event.type)
    ) {
      setSessionRevisions((current) => ({
        ...current,
        [sessionID]: (current[sessionID] ?? 0) + 1,
      }))
    }
    if (event.type === "session.status") {
      const status = properties.status as { type?: SessionSummary["status"] }
      setSessions((current) =>
        current.map((session) =>
          session.id === properties.sessionID ? { ...session, status: status.type ?? session.status } : session,
        ),
      )
    }
    if (event.type === "session.idle") {
      setSessions((current) =>
        current.map((session) =>
          session.id === properties.sessionID ? { ...session, status: "idle" } : session,
        ),
      )
    }
    if (event.type === "session.error") {
      setSessions((current) =>
        current.map((session) =>
          session.id === properties.sessionID ? { ...session, status: "error" } : session,
        ),
      )
    }
    if (["permission.updated", "permission.asked"].includes(event.type)) {
      const parsed = permissionRequestSchema.safeParse(properties)
      if (parsed.success) {
        setPermissions((current) => [...current.filter((item) => item.id !== parsed.data.id), parsed.data])
      }
    }
    if (event.type === "permission.replied") {
      setPermissions((current) =>
        current.filter((item) => item.id !== (properties.requestID ?? properties.permissionID)),
      )
    }
    if (event.type === "question.asked") {
      const question = properties as QuestionRequest
      setQuestions((current) => [...current.filter((item) => item.id !== question.id), question])
    }
    if (["question.replied", "question.rejected"].includes(event.type)) {
      setQuestions((current) => current.filter((item) => item.id !== properties.requestID))
    }
  }

  const request = useCallback((command: Omit<ClientCommand, "requestId">): Promise<unknown> => {
    const socket = socketRef.current
    if (!socket || socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error("Relay is offline"))
    const requestId = crypto.randomUUID()
    socket.send(JSON.stringify({ ...command, requestId }))
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        pendingRef.current.delete(requestId)
        reject(new Error("The relay did not respond."))
      }, 15_000)
      pendingRef.current.set(requestId, { resolve, reject, timeout })
    })
  }, [])

  const toggleNotifications = useCallback(async () => {
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setError("This browser does not support PWA notifications.")
      return
    }
    if (notificationsEnabled) {
      const subscription = await navigator.serviceWorker.ready.then((registration) =>
        registration.pushManager.getSubscription(),
      )
      await subscription?.unsubscribe()
      localStorage.removeItem("remotty-notifications")
      localStorage.removeItem("opencode-relay-notifications")
      setNotificationsEnabled(false)
      return
    }
    const permission = await Notification.requestPermission()
    if (permission !== "granted") {
      setError("Notification permission was not granted.")
      return
    }
    const code = storedCredential()
    if (!code) {
      setError("Connect the relay before you enable notifications.")
      return
    }
    try {
      await registerPush(code)
      localStorage.setItem("remotty-notifications", "enabled")
      setNotificationsEnabled(true)
    } catch (error) {
      setError((error as Error).message)
    }
  }, [notificationsEnabled])

  useEffect(() => {
    const code = new URLSearchParams(location.search).get("code") ?? storedCredential()
    if (code) connect(code)
    return () => {
      const socket = socketRef.current
      socketRef.current = undefined
      socket?.close(1000, "Page closed")
    }
  }, [connect])

  return {
    connection,
    relay,
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
  }
}
