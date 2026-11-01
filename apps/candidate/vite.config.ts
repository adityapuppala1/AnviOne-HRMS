import { defineConfig } from "vite";
import tailwind from "@tailwindcss/vite";
export default defineConfig({
  plugins: [tailwind()],
  server: {
    host: "127.0.0.2",
    port: 5174,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:4001" },
  },
  preview: {
    host: "127.0.0.2",
    port: 5174,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:4001" },
  },
  build: { outDir: "build" },
});
