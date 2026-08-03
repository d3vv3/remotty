import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["src/server.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  minify: true,
  sourcemap: false,
  clean: true,
  noExternal: ["@remotty/protocol", "zod"],
})
