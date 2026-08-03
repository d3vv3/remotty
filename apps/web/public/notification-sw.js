self.addEventListener("push", (event) => {
  const payload = event.data?.json()
  if (!payload) return
  if (payload.closeTag) {
    event.waitUntil(
      self.registration.getNotifications({ tag: payload.closeTag }).then((notifications) => {
        for (const notification of notifications) notification.close()
      }),
    )
    return
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      requireInteraction: payload.requireInteraction,
      actions: payload.actions,
      data: payload.data,
      icon: "/icon.svg",
      badge: "/icon.svg",
    }),
  )
})

self.addEventListener("message", (event) => {
  if (event.data?.type !== "notification.close" || !event.data.tag) return
  event.waitUntil(
    self.registration.getNotifications({ tag: event.data.tag }).then((notifications) => {
      for (const notification of notifications) notification.close()
    }),
  )
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const data = event.notification.data
  if (data?.type === "permission" && ["reject", "once", "always"].includes(event.action)) {
    event.waitUntil(
      fetch(`${data.brokerUrl}/push/action`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: data.code,
          command: {
            type: "permission.reply",
            requestId: crypto.randomUUID(),
            sessionId: data.sessionId,
            permissionId: data.permissionId,
            response: event.action,
          },
        }),
      }),
    )
    return
  }

  const url = new URL("/", self.location.origin)
  if (data?.sessionId) url.searchParams.set("session", data.sessionId)
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const client = windows[0]
      if (client) {
        client.navigate(url.href)
        return client.focus()
      }
      return clients.openWindow(url.href)
    }),
  )
})
