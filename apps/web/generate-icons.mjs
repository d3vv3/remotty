// Run with Node and ImageMagick: node apps/web/generate-icons.mjs
// Standalone icons cannot inherit CSS; materialize the shared brand tokens.
import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { execFileSync } from "node:child_process"

const publicDir = new URL("./public/", import.meta.url)
const tokens = readFileSync(new URL("design-tokens.css", publicDir), "utf8")
const color = (name) => {
  const value = tokens.match(new RegExp(`--${name}: (#[a-fA-F0-9]{6});`))?.[1]
  if (!value) throw new Error(`Missing brand token: ${name}`)
  return value
}
export const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="28" fill="${color("brand")}"/>
  <path d="m45 46-18 18 18 18m38-36 18 18-18 18M72 38 56 90" fill="none" stroke="${color("on-brand")}" stroke-linecap="round" stroke-linejoin="round" stroke-width="8"/>
</svg>
`
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const svgPath = fileURLToPath(new URL("icon.svg", publicDir))
  writeFileSync(svgPath, iconSvg)
  for (const size of [192, 512]) {
    execFileSync("convert", ["-background", "none", "-density", "384", svgPath, "-resize", `${size}x${size}`, `PNG32:${fileURLToPath(new URL(`icon-${size}.png`, publicDir))}`])
  }
}
