import { defineConfig, devices } from "@playwright/test";

/**
 * 示範站主要功能檢查（e2e-demo/）。
 *   本機副本（預設）：自動 build 前端，以 worker/wrangler.demo.jsonc（每個瀏覽器一份、免同步碼、豐富示範資料）開在 http://localhost:8788
 *   線上示範站：DEMO_URL=https://zhunan-cold-storage-demo.liao950715.workers.dev npm run test:demo-site
 * 每個測試都是新的瀏覽器 → 各自一份全新的示範資料，不會影響其他訪客。
 */
const live = process.env.DEMO_URL?.replace(/\/$/, "");
const local = "http://localhost:8788";

export default defineConfig({
  testDir: "e2e-demo",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: "test-results/demo-site",
  use: {
    baseURL: live ?? local,
    locale: "zh-TW",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    serviceWorkers: "block", // 每次都拿伺服器上的最新版，不受 PWA 快取影響
  },
  webServer: live
    ? undefined
    : { command: "npm run build -w web && npm run dev:demo -w worker", url: `${local}/api/health`, reuseExistingServer: true, timeout: 180_000 },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } }, testIgnore: /mobile\.spec\.ts/ },
    { name: "mobile", use: { ...devices["Pixel 5"] }, testMatch: /mobile\.spec\.ts/ },
  ],
});
