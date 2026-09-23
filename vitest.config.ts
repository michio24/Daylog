import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// アプリのビルド設定（vite.config.ts）とは分けている。テストに必要なのは
// React の変換だけで、dev サーバーや Tauri 向けのビルド設定は要らない。
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"]
  }
});
