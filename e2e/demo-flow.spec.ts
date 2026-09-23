import { expect, test } from "@playwright/test";
import { api, clickCell, locationIdByCode, pairAndLogin, productByName, resetDemo, selectByText } from "./helpers";

/**
 * PRD §7 整合展示情境：甘藍菜入庫 30（分兩儲位）→ 搬移 5 → 出庫 10 → 報損 3 → 最終 17，
 * 批次、儲位與異動紀錄相互一致。全部走 UI。
 */
test.describe.serial("整合展示情境（AT-03/13/11/19/25、AT-08）", () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await resetDemo(page);
    await page.close();
  });

  test("入庫 30 籠分兩儲位 → 搬移 5 → 出庫 10 → 報損 3 ＝ 17，重新整理後仍為 17", async ({ page }) => {
    await pairAndLogin(page, "staff");

    // ---- 入庫（AT-03、AT-04 即時提示）----
    await page.goto("/inbound");
    await selectByText(page.getByRole("listbox", { name: "商品" }).or(page.getByRole("combobox", { name: "商品", exact: true })), "甘藍菜");
    await page.getByLabel("數量").fill("30");
    await page.getByRole("button", { name: "30 天後" }).click();
    await page.getByRole("button", { name: "分到其他儲位" }).click();
    const selects = page.getByRole("combobox", { name: "儲位", exact: true });
    await selectByText(selects.nth(0), "A-01-03");
    await selectByText(selects.nth(1), "A-01-04");
    await page.getByLabel("第 1 個儲位數量").fill("20");
    await page.getByLabel("第 2 個儲位數量").fill("5");
    await expect(page.getByText("還有 5 籠 沒分配").first()).toBeVisible(); // AT-04：合計不符不可送出
    await expect(page.getByRole("button", { name: "下一步：核對並入庫" })).toBeDisabled();
    await page.getByLabel("第 2 個儲位數量").fill("10");
    await page.getByRole("button", { name: "下一步：核對並入庫" }).click();
    await expect(page.getByText("甘藍菜，入庫 30 籠")).toBeVisible();
    await page.getByRole("button", { name: "確認入庫" }).click();
    await expect(page.getByText("✓ 入庫完成")).toBeVisible();
    const cabbage = await productByName(page, "甘藍菜");
    expect((await api(page, "GET", `/products/${cabbage.id}/stock`)).total).toBe(30);

    // ---- 搬移 5：A-01-03 → A-01-05（AT-13）----
    const from = await locationIdByCode(page, "A-01-03");
    await page.goto(`/transfer?locationId=${from}`);
    await expect(page.getByText("① 從這裡搬出")).toBeVisible();
    await page.getByLabel("搬移數量").fill("5");
    await page.getByRole("button", { name: "下一步：選搬到哪裡" }).click();
    // 終點用平面圖點選：用 helper 依幾何座標點 A-01-05
    await clickCell(page, "A-01-05");
    await expect(page.getByText("② 搬到這裡").first()).toBeVisible();
    await expect(page.getByText(/從 A-01-03 → A-01-05/)).toBeVisible();
    await page.getByRole("button", { name: "確認搬移" }).click();
    await expect(page.getByText("✓ 搬移完成")).toBeVisible();
    expect((await api(page, "GET", `/products/${cabbage.id}/stock`)).total).toBe(30); // 總量不變

    // ---- 出庫 10（AT-11：建議先到期先出，人工確認）----
    await page.goto("/outbound");
    await selectByText(page.getByRole("listbox", { name: "商品" }).or(page.getByRole("combobox", { name: "商品", exact: true })), "甘藍菜");
    await page.getByLabel("出庫數量").fill("10");
    await expect(page.getByText(/從 A-01-0\d 取 \d+ 籠/).first()).toBeVisible();
    await expect(page.getByText("最早到期").first()).toBeVisible();
    await page.getByRole("button", { name: "下一步：核對並出庫" }).click();
    await expect(page.getByText("甘藍菜，出庫 10 籠")).toBeVisible();
    await page.getByRole("button", { name: "確認出庫" }).click();
    await expect(page.getByText("✓ 出庫完成")).toBeVisible();
    expect((await api(page, "GET", `/products/${cabbage.id}/stock`)).total).toBe(20);

    // ---- 報損 3（AT-19）：從 A-01-04 ----
    const dmgLoc = await locationIdByCode(page, "A-01-04");
    await page.goto(`/damage?locationId=${dmgLoc}`);
    await page.getByLabel("報損數量").fill("3");
    await page.getByRole("button", { name: "壓損" }).click();
    await page.getByRole("button", { name: "下一步：核對並報損" }).click();
    await page.getByRole("button", { name: "確認報損" }).click();
    await expect(page.getByText("✓ 報損完成")).toBeVisible();

    // ---- 查庫存 = 17，重新整理後仍 17（AT-08）----
    await page.goto("/inventory?q=甘藍菜");
    await expect(page.getByText(/甘藍菜\s*17 籠/)).toBeVisible();
    await page.reload();
    await expect(page.getByText(/甘藍菜\s*17 籠/)).toBeVisible();
    const stock = await api(page, "GET", `/products/${cabbage.id}/stock`);
    expect(stock.total).toBe(17);
    expect(stock.lines.reduce((s: number, l: { quantity: number }) => s + l.quantity, 0)).toBe(17);

    // ---- 異動紀錄四類可查（AT-25）----
    await page.goto("/movements");
    for (const t of ["入庫", "出庫", "搬移", "報損"]) {
      await page.getByRole("button", { name: t, exact: true }).click();
      await expect(page.getByText(/共 [1-9]\d* 筆/)).toBeVisible();
    }
  });

  test("AT-09／AT-10：搜尋批次／儲位並定位到平面圖高亮", async ({ page }) => {
    await pairAndLogin(page, "staff");
    await page.goto("/inventory");
    await page.getByLabel("搜尋商品或儲位").fill("A-01-05");
    await page.getByRole("button", { name: "找貨" }).click();
    await expect(page.getByText(/甘藍菜/).first()).toBeVisible();
    await page.getByRole("link", { name: /在 A 庫平面圖標出位置/ }).click();
    await expect(page).toHaveURL(/floorplan\?warehouse=A&highlight=A-01-05/);
    await expect(page.getByText("搜尋結果").first()).toBeVisible();
    await page.getByRole("button", { name: /清除搜尋標示/ }).click();
    await expect(page).not.toHaveURL(/highlight=/);
  });
});
