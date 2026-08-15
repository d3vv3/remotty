export const UNKNOWN_PWA_BUILD = "Unknown"

export const shouldShowPwaUpdate = (needRefresh: boolean, pathname: string, paired: boolean): boolean => (
  needRefresh && pathname !== "/pair" && (pathname === "/app" || paired)
)

export const pwaBuildFromModuleScriptUrls = (scriptUrls: Iterable<string>, origin: string): string => {
  let currentOrigin: string
  try {
    currentOrigin = new URL(origin).origin
  } catch {
    return UNKNOWN_PWA_BUILD
  }

  for (const scriptUrl of scriptUrls) {
    try {
      const url = new URL(scriptUrl, currentOrigin)
      const filename = url.pathname.split("/").at(-1)
      if (url.origin === currentOrigin && filename && /^index-[A-Za-z0-9_-]+\.js$/.test(filename)) return filename
    } catch {
      continue
    }
  }

  return UNKNOWN_PWA_BUILD
}
