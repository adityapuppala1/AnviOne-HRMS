import { defineConfig } from "vite";

// Local artifact preview for browser acceptance checks, not a production server.
export default defineConfig({
  build: { outDir: "build/client" },
  preview: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:4000" },
  },
});
