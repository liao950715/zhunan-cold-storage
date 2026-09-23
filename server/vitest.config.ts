import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./src/__tests__/globalSetup.ts"],
    setupFiles: ["./src/__tests__/setup.ts"],
    fileParallelism: false, // 共用同一個測試 SQLite 檔
    testTimeout: 20000,
    hookTimeout: 60000,
  },
});
