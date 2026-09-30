/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "fonts/*.ttf"],
      manifest: {
        name: "ویزیتور — راننده",
        short_name: "ویزیتور راننده",
        description: "اجرای توزیع و ثبت کد تحویل برای رانندگان شرکت پخش",
        lang: "fa",
        dir: "rtl",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        scope: "/",
        theme_color: "#F2F2F7",
        background_color: "#F2F2F7",
        icons: [{ src: "/favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
      },
      workbox: {
        cacheId: "visitor-driver-v1",
        globPatterns: ["**/*.{js,css,html,svg,ttf,woff2}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /\.[a-z0-9]+$/i],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: parseInt(process.env.PORT || "8445"),
    strictPort: true,
  },
  preview: {
    port: parseInt(process.env.PORT || "8445"),
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.ts",
    env: { VITE_API_MODE: "mock" },
  },
});
