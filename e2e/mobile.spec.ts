import { expect, test } from "@playwright/test";
import { pairAndLogin, resetDemo } from "./helpers";

/** NFR-02：手機寬度能完成核心操作，選單不橫向捲動、頁面不橫向溢出。 */
test.describe("手機寬度", () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await resetDemo(page);
    await page.close();
  });

  test("首頁、入庫、平面圖在手機上不溢出且主要按鈕可見", async ({ page }) => {
    await pairAndLogin(page, "staff");
    for (const path of ["/", "/inbound", "/outbound", "/floorplan?warehouse=A"]) {
      await page.goto(path);
      await page.waitForTimeout(500);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${path} 橫向溢出 ${overflow}px`).toBeLessThanOrEqual(1);
    }
    await page.goto("/");
    await expect(page.getByRole("link", { name: /入庫/ }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /出庫/ }).first()).toBeVisible();
    await page.getByRole("button", { name: "其他" }).click();
    await expect(page.getByRole("link", { name: "平面圖", exact: true })).toBeVisible();
  });
});
