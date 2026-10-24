import { defineConfig } from "vite";
import { reactRouter } from "@react-router/dev/vite";
import tailwind from "@tailwindcss/vite";
export default defineConfig({
  plugins: [tailwind(), reactRouter()],
  server: {
    port: 5173,
    strictPort: true,
    host: "127.0.0.1",
    proxy: { "/api": "http://127.0.0.1:4000" },
  },
});
