import { expect, test } from "@playwright/test";
import { api, locationIdByCode, pairAndLogin, productByName, resetDemo } from "./helpers";

test.describe.serial("FR-020 庫存異動復原（AT-33、AT-34、AT-41）", () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await resetDemo(page);
    await page.close();
  });

  test("AT-34：工作人員在紀錄頁看不到「復原這筆操作」", async ({ page }) => {
    await pairAndLogin(page, "staff");
    const carrot = await productByName(page, "紅蘿蔔");
    const loc = await locationIdByCode(page, "A-01-02");
    const batchId = (await api(page, "GET", `/locations/${loc}`)).lines[0].batch.id;
    await api(page, "POST", "/stock/outbound", { productId: carrot.id, lines: [{ batchId, locationId: loc, quantity: 3 }] }); // 8 → 5
    await page.goto("/movements");
    await expect(page.getByText(/紅蘿蔔 −3 箱/)).toBeVisible();
    await expect(page.getByRole("button", { name: "復原這筆操作" })).toHaveCount(0);
  });

  test("AT-33／AT-41：管理員復原錯誤出庫，重新整理後「已復原」與反向紀錄仍在", async ({ page }) => {
    await pairAndLogin(page, "admin");
    await page.goto("/movements");
    await page.getByRole("button", { name: "出庫", exact: true }).click();
    await page.getByRole("button", { name: "復原這筆操作" }).first().click();
    await expect(page.getByText("預計復原的庫存變化")).toBeVisible();
    await expect(page.getByText(/A-01-02：5 → 8 箱/)).toBeVisible();
    await expect(page.getByRole("button", { name: "確認復原" })).toBeDisabled(); // 原因必填
    await page.getByLabel("復原原因（必填）").fill("出錯單");
    await page.getByRole("button", { name: "確認復原" }).click();
    await expect(page.getByText(/已復原紀錄 #\d+，新增反向紀錄/)).toBeVisible();
    const loc = await locationIdByCode(page, "A-01-02");
    expect((await api(page, "GET", `/locations/${loc}`)).occupied).toBe(8);

    await page.reload();
    await page.getByRole("button", { name: "出庫", exact: true }).click();
    await expect(page.getByText(/已復原（紀錄 #\d+）/)).toBeVisible();
    await expect(page.getByRole("button", { name: "復原這筆操作" })).toHaveCount(0);
    await page.getByRole("button", { name: "復原", exact: true }).click();
    await expect(page.getByText(/復原 #\d+：紅蘿蔔 3 箱/)).toBeVisible();
    await expect(page.getByText(/原因：出錯單/)).toBeVisible();
  });
});
