import { expect, test } from "@playwright/test";
import { api, locationIdByCode, pairAndLogin, productByName, resetDemo } from "./helpers";

test.describe.serial("盤點與權限（AT-21～AT-24、NFR-04）", () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await resetDemo(page);
    await page.close();
  });

  test("AT-21／22：工作人員提交盤點後庫存不變，看不到也呼叫不了核准", async ({ page }) => {
    await pairAndLogin(page, "staff");
    await page.goto("/stocktake");
    await page.getByRole("button", { name: "＋ 新盤點" }).click();
    await page.getByLabel("A-01-01 實盤數量").fill("10"); // 系統 12 → 實盤 10
    await expect(page.getByText("少 2")).toBeVisible();
    await page.getByRole("button", { name: "提交盤點" }).click();
    await page.getByRole("button", { name: "確定" }).click();
    await expect(page.getByText(/盤點單 #\d+ 已提交/)).toBeVisible();
    await expect(page.getByRole("button", { name: "核准" })).toHaveCount(0);
    const loc = await locationIdByCode(page, "A-01-01");
    expect((await api(page, "GET", `/locations/${loc}`)).occupied).toBe(12);
    const res = await page.request.post("/api/stocktakes/1/approve", { data: {} });
    expect(res.status()).toBe(403);
  });

  test("AT-23：管理員核准後庫存變為實盤並產生調整紀錄", async ({ page }) => {
    await pairAndLogin(page, "admin");
    await page.goto("/stocktake");
    await expect(page.getByText(/有 1 張待核准/)).toBeVisible();
    await page.getByRole("button", { name: "核准" }).click();
    await page.getByRole("button", { name: "確定" }).click();
    await expect(page.getByText(/已核准，產生 1 筆調整/)).toBeVisible();
    const loc = await locationIdByCode(page, "A-01-01");
    expect((await api(page, "GET", `/locations/${loc}`)).occupied).toBe(10);
    await page.goto("/movements");
    await page.getByRole("button", { name: "盤點調整" }).click();
    await expect(page.getByText(/共 1 筆/)).toBeVisible();
  });

  test("AT-24：提交後庫存又改變，核准時被拒", async ({ page }) => {
    await pairAndLogin(page, "admin");
    const carrot = await productByName(page, "紅蘿蔔");
    const loc = await locationIdByCode(page, "A-01-02");
    const st = await api(page, "POST", "/stocktakes", { items: [{ locationId: loc, batchId: (await api(page, "GET", `/locations/${loc}`)).lines[0].batch.id, countedQty: 7 }] });
    await api(page, "POST", "/stock/outbound", { productId: carrot.id, lines: [{ batchId: st.items[0].batchId, locationId: loc, quantity: 1 }] });
    await page.goto("/stocktake");
    await page.getByRole("button", { name: "核准" }).click();
    await page.getByRole("button", { name: "確定" }).click();
    await expect(page.getByText(/無法核准：盤點提交後庫存已變動/)).toBeVisible();
    expect((await api(page, "GET", `/stocktakes/${st.id}`)).status).toBe("PENDING");
  });
});
