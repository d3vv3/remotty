export type DeviceHints = {
  userAgent: string
  platform: string
  maxTouchPoints: number
}

const browserName = (userAgent: string) => {
  if (/EdgA?\//.test(userAgent) || /EdgiOS\//.test(userAgent)) return "Edge"
  if (/FxiOS\//.test(userAgent) || /Firefox\//.test(userAgent)) return "Firefox"
  if (/CriOS\//.test(userAgent) || /Chrome\//.test(userAgent) || /Chromium\//.test(userAgent)) return "Chrome"
  if (/Safari\//.test(userAgent)) return "Safari"
  return "Browser"
}

const operatingSystemName = ({ userAgent, platform, maxTouchPoints }: DeviceHints) => {
  if (/iPad/.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1)) return "iPadOS"
  if (/iPhone|iPod/.test(userAgent)) return "iOS"
  if (/Android/.test(userAgent)) return "Android"
  if (/CrOS/.test(userAgent)) return "ChromeOS"
  if (/Windows/.test(userAgent) || /^Win/.test(platform)) return "Windows"
  if (/Macintosh|Mac OS X/.test(userAgent) || /^Mac/.test(platform)) return "macOS"
  if (/Linux/.test(userAgent) || /^Linux/.test(platform)) return "Linux"
  return "Device"
}

export const deviceName = (deviceId: string, hints: DeviceHints) =>
  `${browserName(hints.userAgent)} on ${operatingSystemName(hints)} (${deviceId.slice(0, 6)})`

export const currentDeviceName = (deviceId: string) => deviceName(deviceId, {
  userAgent: navigator.userAgent,
  platform: navigator.platform,
  maxTouchPoints: navigator.maxTouchPoints,
})
