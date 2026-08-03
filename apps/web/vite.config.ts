import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"
import { VitePWA } from "vite-plugin-pwa"

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    VitePWA({
      registerType: "autoUpdate",
      devOptions: { enabled: true },
      workbox: { importScripts: ["/notification-sw.js"], clientsClaim: true, skipWaiting: true },
      manifest: {
        name: "remotty",
        short_name: "remotty",
        description: "Control OpenCode sessions from your phone.",
        theme_color: "#111412",
        background_color: "#090a0b",
        display: "standalone",
        start_url: "/app",
        icons: [
          {
            src: "/icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable",
          },
        ],
      },
    }),
  ],
  server: { port: 5173 },
})
