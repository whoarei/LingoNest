import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
export default defineConfig({
  plugins: [vue()],
  build: { target: "chrome74" },
  server: { port: 5173, strictPort: true },
});
