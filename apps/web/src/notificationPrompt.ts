export const NOTIFICATION_PROMPT_SEEN = "remotty-notification-prompt-seen"

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
