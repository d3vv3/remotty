import { describe, expect, it } from "vitest"
import { UNKNOWN_PWA_BUILD, pwaBuildFromModuleScriptUrls } from "../src/features/pwa/pwaUpdate"

describe("PWA build diagnostics", () => {
  const origin = "https://remotty.example"

  it("returns the same-origin active entry asset filename without query parameters", () => {
    expect(pwaBuildFromModuleScriptUrls([
      "https://cdn.example/assets/index-external.js",
      "/assets/vendor-D6F0iizK.js",
      "https://remotty.example/assets/index-CrOUMabm.js?cache=stale",
    ], origin)).toBe("index-CrOUMabm.js")
  })

  it("returns Unknown when no same-origin PWA entry asset is present", () => {
    expect(pwaBuildFromModuleScriptUrls(["/assets/vendor-D6F0iizK.js", "https://cdn.example/assets/index-CrOUMabm.js"], origin)).toBe(UNKNOWN_PWA_BUILD)
  })
})
