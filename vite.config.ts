import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: "127.0.0.1",
    // Rust sources and build artifacts are watched by Tauri, not Vite.
    watch: { ignored: ["**/src-tauri/**"] }
  },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: { target: "chrome105", minify: !process.env.TAURI_ENV_DEBUG, sourcemap: !!process.env.TAURI_ENV_DEBUG }
});
