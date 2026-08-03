export const pairingUrl = (brokerUrl: string, code: string, appUrl?: string) => {
  const broker = new URL(brokerUrl)
  const target = new URL(appUrl ?? broker.origin)
  target.protocol = target.protocol === "ws:" ? "http:" : target.protocol === "wss:" ? "https:" : target.protocol
  if (!appUrl && ["localhost", "127.0.0.1"].includes(target.hostname) && target.port === "8787") {
    target.port = "5173"
  }
  target.pathname = "/"
  target.search = ""
  target.hash = ""
  target.searchParams.set("code", code)
  return target.href
}
