export const NOTIFICATION_PROMPT_SEEN = "remotty-notification-prompt-seen"

export const notificationPromptWasSeen = () => {
  try {
    return localStorage.getItem(NOTIFICATION_PROMPT_SEEN) === "true"
  } catch {
    return false
  }
}

export const markNotificationPromptSeen = () => {
  try { localStorage.setItem(NOTIFICATION_PROMPT_SEEN, "true") } catch { /* Storage may be unavailable in private contexts. */ }
}

export const clearNotificationPromptSeen = () => {
  try { localStorage.removeItem(NOTIFICATION_PROMPT_SEEN) } catch { /* Storage may be unavailable in private contexts. */ }
}

export const shouldOfferPushNotifications = ({
  connected,
  hasRelay,
  enabled,
  supported,
  permission,
  seen,
}: {
  connected: boolean
  hasRelay: boolean
  enabled: boolean
  supported: boolean
  permission: NotificationPermission | "unsupported"
  seen: boolean
}) => connected && hasRelay && !enabled && supported && permission !== "denied" && !seen
