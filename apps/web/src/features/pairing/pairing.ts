import { decodePairingBundle, PAIRING_BUNDLE_PREFIX, type PairingBundle } from "@remotty/protocol"

export const pairingBundleFrom = (value: string): PairingBundle | undefined => {
  const input = value.trim()
  let token: string
  if (input.startsWith(PAIRING_BUNDLE_PREFIX)) {
    token = input
  } else {
    try {
      const url = new URL(input)
      if (!url.hash || url.search) return undefined
      token = decodeURIComponent(url.hash.slice(1))
    } catch {
      return undefined
    }
  }
  if (!token.startsWith(PAIRING_BUNDLE_PREFIX) || token.includes("#") || token.includes("?")) return undefined
  try {
    return decodePairingBundle(token)
  } catch {
    return undefined
  }
}

export const routeForEnrollment = (enrolled: boolean | undefined) =>
  enrolled === undefined ? undefined : enrolled ? "/app" : "/pair"

export const routeForStoredIdentity = (pathname: string, enrolled: boolean) =>
  pathname === "/" && enrolled ? "/app" : pathname
