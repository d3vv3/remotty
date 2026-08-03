import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts"],
  format: ["esm"],
  dts: true,
  minify: true,
  sourcemap: false,
  clean: true,
  noExternal: ["@remotty/protocol"],
})
