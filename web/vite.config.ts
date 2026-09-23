import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["fonts/Iansui-Regular.woff2", "icons/icon.svg"],
      manifest: {
        name: "竹南冷凍倉儲庫存管理系統",
        short_name: "冷凍倉儲",
        description: "商品、批次、儲位三層追蹤的冷凍庫庫存管理",
        lang: "zh-Hant",
        start_url: "/",
        display: "standalone",
        background_color: "#FAFAF7",
        theme_color: "#7297AC",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // API 一律走網路（庫存資料不可用舊快取）；字體與靜態檔快取
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          { urlPattern: /\/api\//, handler: "NetworkOnly" },
          { urlPattern: /\/fonts\//, handler: "CacheFirst", options: { cacheName: "fonts", expiration: { maxEntries: 4, maxAgeSeconds: 60 * 60 * 24 * 365 } } },
        ],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:8787" },
  },
});
