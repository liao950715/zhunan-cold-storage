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
    for (const path of ["/", "/inbound", "/outbound", "/floorplan?warehouse=A", "/transfer", "/stocktake", "/movements"]) {
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

  test("手機：盤點單用卡片顯示，主要按鈕不用橫向捲動就看得到", async ({ page }) => {
    await pairAndLogin(page, "admin");
    await page.goto("/stocktake");
    await page.getByRole("button", { name: "＋ 新盤點" }).click();
    await page.getByRole("button", { name: "提交盤點" }).click();
    await page.getByRole("button", { name: "確定" }).click();
    const approve = page.getByRole("button", { name: "核准" }).first();
    await expect(approve).toBeVisible();
    const box = (await approve.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await page.getByRole("button", { name: "看明細" }).first().click();
    await expect(page.getByText(/系統 \d+ → 實盤 \d+/).first()).toBeVisible();
  });

  test("手機：搬移預設大字列表，點列表也能選起點與終點", async ({ page }) => {
    await pairAndLogin(page, "staff");
    await page.goto("/transfer");
    await expect(page.getByRole("button", { name: "大字列表" })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("listitem").filter({ hasText: "A-01-01" }).click();
    await expect(page.getByText("① 從這裡搬出").first()).toBeVisible();
    await page.getByLabel("搬移數量").fill("1");
    await page.getByRole("button", { name: "下一步：選搬到哪裡" }).first().click();
    await page.getByRole("listitem").filter({ hasText: "A-01-06" }).click();
    await expect(page.getByRole("button", { name: /確認搬移/ }).first()).toBeVisible();
  });
});
