import { expect, test } from "@playwright/test";
import { api, clickCell, pairAndLogin, resetDemo } from "./helpers";

test.describe.serial("平面圖配置編輯（AT-15、AT-16、AT-17）", () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await resetDemo(page);
    await page.close();
  });

  test("AT-15／16：工作人員新增貨架並儲存，重新整理後保留且庫存不變", async ({ page }) => {
    await pairAndLogin(page, "staff");
    const before = await api(page, "GET", "/search?q=紅蘿蔔");
    await page.goto("/floorplan?warehouse=A");
    await expect(page.getByText("4 座貨架")).toBeVisible();
    await expect(page.locator(".konvajs-content")).toBeVisible(); // 等平面圖（layout）載入完再進編輯
    await page.getByRole("button", { name: "調整貨架配置（管理用）" }).click();
    await expect(page.getByText("正在調整貨架配置")).toBeVisible();
    await page.getByRole("button", { name: "＋ 新增貨架" }).click();
    await expect(page.getByRole("heading", { name: "貨架 05" })).toBeVisible(); // 新貨架已在側欄
    await page.getByRole("button", { name: "儲存倉庫配置" }).click();
    await expect(page.getByText(/新增貨架 05/)).toBeVisible(); // 儲存前先核對變更
    await page.getByRole("button", { name: "確定" }).click();
    await expect(page.getByText("倉庫配置已儲存")).toBeVisible();
    await page.reload();
    await expect(page.getByText("5 座貨架")).toBeVisible();
    const after = await api(page, "GET", "/search?q=紅蘿蔔");
    expect(after.lines).toEqual(before.lines);
  });

  test("AT-17：刪除有庫存儲位被拒絕，訊息說明原因", async ({ page }) => {
    await resetDemo(page); // 上一個測試新增的貨架會蓋住 A-01-01，先還原
    await pairAndLogin(page, "staff");
    await page.goto("/floorplan?warehouse=A");
    await page.getByRole("button", { name: "調整貨架配置（管理用）" }).click();
    await clickCell(page, "A-01-01");
    await expect(page.getByRole("heading", { name: "儲位 A-01-01" })).toBeVisible();
    await page.getByRole("button", { name: "刪除所選" }).click();
    await page.getByRole("button", { name: "確定" }).click();
    await expect(page.getByText(/無法刪除：儲位 A-01-01 尚有庫存/)).toBeVisible();
  });

  test("一般模式點儲位看到內容與操作按鈕（AT-18 入口）", async ({ page }) => {
    await pairAndLogin(page, "staff");
    await page.goto("/floorplan?warehouse=A");
    await clickCell(page, "A-01-01");
    await expect(page.getByRole("heading", { name: "A-01-01" })).toBeVisible();
    await expect(page.getByText("紅蘿蔔")).toBeVisible();
    await page.getByRole("button", { name: "從這裡取貨（出庫）" }).click();
    await expect(page).toHaveURL(/\/outbound\?productId=\d+&locationId=\d+/);
    await expect(page.getByText(/從 A-01-01 取/)).toBeVisible();
  });
});
