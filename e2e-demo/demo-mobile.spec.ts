import { expect, test } from "@playwright/test";
import { demoNote, login } from "./helpers";

/** 示範站手機寬度（NFR-02）：主要頁面不橫向溢出；示範說明與「重置示範資料」按鈕不用橫向捲動就按得到。 */
test("手機：登入後主要頁面不橫向溢出，重置按鈕看得到", async ({ page }) => {
  await login(page, "staff");
  for (const path of ["/", "/inbound", "/outbound", "/transfer", "/damage", "/stocktake", "/movements"]) {
    await page.goto(path);
    await expect(demoNote(page)).toBeVisible();
    await page.waitForTimeout(300);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${path} 橫向溢出 ${overflow}px`).toBeLessThanOrEqual(1);
  }
  const box = (await demoNote(page).getByRole("button", { name: "重置示範資料" }).boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
});
