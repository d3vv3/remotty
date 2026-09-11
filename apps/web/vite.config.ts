import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"
import { VitePWA } from "vite-plugin-pwa"

export default defineConfig({
  plugins: [
    {
      name: "static-install-guide",
      configureServer(server) {
        // Vite's public middleware serves files, not directory indexes.
        server.middlewares.use((req, _res, next) => {
          if (req.url && /^\/install\/?(?:\?|$)/.test(req.url)) {
            req.url = req.url.replace(/^\/install\/?/, "/install/index.html")
          }
          next()
        })
      },
    },
    tailwindcss(),
    react(),
    VitePWA({
      registerType: "prompt",
      devOptions: { enabled: true },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,webp,woff2}"],
        importScripts: ["/notification-sw.js"],
        navigateFallbackAllowlist: [/^\/(?:privacy|pair|app)?$/],
      },
      manifest: {
        name: "remotty",
        short_name: "remotty",
        description: "Control OpenCode sessions from your phone.",
        theme_color: "#08111f",
        background_color: "#08111f",
        display: "standalone",
        start_url: "/app",
        id: "/app",
        scope: "/",
        icons: [
          {
            src: "/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any maskable",
          },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
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
