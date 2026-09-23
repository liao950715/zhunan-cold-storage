import { defineConfig, devices } from "@playwright/test";
import { readFileSync } from "node:fs";

/** 本機同步碼：從 worker/.dev.vars 讀（不進 repo）。 */
function localSyncCode() {
  try {
    const m = /SYNC_SECRET=(.+)/.exec(readFileSync("worker/.dev.vars", "utf8"));
    return m?.[1].trim() ?? "";
  } catch {
    return "";
  }
}

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1, // 共用同一個本機 DO 資料庫，序列執行
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "zh-TW",
  },
  metadata: { syncCode: localSyncCode() },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 5"] }, testMatch: /mobile\.spec\.ts/ },
  ],
});
