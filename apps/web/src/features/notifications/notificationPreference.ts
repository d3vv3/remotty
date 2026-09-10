export function persistNotificationPreference(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem("remotty-notifications", "enabled")
    else localStorage.removeItem("remotty-notifications")
  } catch { /* Preference storage must not interrupt Push lifecycle or UI updates. */ }
}
