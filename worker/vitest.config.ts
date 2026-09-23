import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 30000,
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.test.jsonc" },
        // 覆蓋 .dev.vars，確保測試用固定的同步碼／JWT secret
        miniflare: { bindings: { JWT_SECRET: "test-secret", SYNC_SECRET: "test-sync-code-0123456789" } },
        isolatedStorage: true, // 每個測試獨立的 DO 儲存：資料庫每次都是乾淨的 seed
        singleWorker: true,
      },
    },
  },
});
