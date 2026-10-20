import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// The frontend. Pages Functions (functions/) are built by wrangler, not Vite.
export default defineConfig({
  plugins: [vue()],
  build: { outDir: "dist", sourcemap: true, target: "es2022" },
  server: { port: 5173 },
});
