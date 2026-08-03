import { encodePairingBundle, isSecureAppUrl, type PairingBundle } from "@remotty/protocol"

export const DEFAULT_BROKER_URL = "wss://remotty.devve.space/ws"

export const pairingUrl = (bundle: PairingBundle, appUrl?: string) => {
  const broker = new URL(bundle.brokerUrl)
  const target = new URL(appUrl ?? broker.origin)
  target.protocol = target.protocol === "ws:" ? "http:" : target.protocol === "wss:" ? "https:" : target.protocol
  if (!appUrl && ["localhost", "127.0.0.1"].includes(target.hostname) && target.port === "8787") {
    target.port = "5173"
  }
  if (!isSecureAppUrl(target.href)) throw new Error("The pairing app must use HTTPS outside loopback")
  target.pathname = "/pair"
  target.search = ""
  target.hash = encodePairingBundle(bundle)
  return target.href
}
