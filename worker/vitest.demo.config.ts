import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

/** 示範站模式（DEMO_SANDBOX=per-browser）：每個瀏覽器一份示範資料的分流、重建與閒置刪除。 */
export default defineWorkersConfig({
  test: {
    include: ["test-demo/**/*.test.ts"],
    testTimeout: 60000,
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.test.jsonc" },
        miniflare: { bindings: { JWT_SECRET: "test-secret", SYNC_SECRET: "test-sync-code-0123456789", DEMO_MODE: "rich", PAIRING: "off", DEMO_SANDBOX: "per-browser" } },
        // 每個測試用自己的 cookie，本來就各自一份資料；DO alarm 與 isolatedStorage 不相容，這裡關閉
        isolatedStorage: false,
        singleWorker: true,
      },
    },
  },
});
