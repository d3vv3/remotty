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
const codeMark = 'm45 46-18 18 18 18m38-36 18 18-18 18M72 38 56 90'
const mark = (stroke) => `<path d="${codeMark}" fill="none" stroke="${stroke}" stroke-linecap="round" stroke-linejoin="round" stroke-width="8"/>`
export const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="28" fill="${color("brand")}"/>
  ${mark(color("on-brand"))}
</svg>
`
// Android tints the alpha mask; the badge deliberately has no colored background.
export const badgeSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="16 16 96 96">${mark("white")}</svg>`
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const svgPath = fileURLToPath(new URL("icon.svg", publicDir))
  writeFileSync(svgPath, iconSvg)
  for (const size of [192, 512]) {
    execFileSync("convert", ["-background", "none", "-density", "384", svgPath, "-resize", `${size}x${size}`, `PNG32:${fileURLToPath(new URL(`icon-${size}.png`, publicDir))}`])
  }
  execFileSync("convert", [fileURLToPath(new URL("icon-192.png", publicDir)), "-strip", `PNG32:${fileURLToPath(new URL("notification-icon-v2.png", publicDir))}`])
  const badgePath = fileURLToPath(new URL("notification-badge-v2.svg", publicDir))
  writeFileSync(badgePath, badgeSvg)
  execFileSync("convert", ["-background", "none", "-density", "384", badgePath, "-resize", "96x96", "-strip", `PNG32:${fileURLToPath(new URL("notification-badge-v2.png", publicDir))}`])
}
