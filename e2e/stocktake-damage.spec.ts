import { expect, test } from "@playwright/test";
import { api, pairAndLogin, resetDemo, selectByText } from "./helpers";

/**
 * 2026-09-30 盤點＋報損（I-20）：盤點時發現腐爛 → 「建立報損」自動帶入 → 報損完成回到盤點
 * → 這一格相符 → 提交 → 管理員核准 0 筆調整；庫存只在報損時扣一次。
 */
test.describe.serial("盤點中建立報損", () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await resetDemo(page);
    await page.close();
  });

  test("工作人員盤點發現爛 3 箱 → 建立報損（自動帶入）→ 回到盤點繼續 → 管理員核准，只扣一次", async ({ page, browser }) => {
    await pairAndLogin(page, "staff");
    const whs = await api<{ items: Array<{ id: number; name: string }> }>(page, "GET", "/warehouses");
    const whA = whs.items.find((w) => w.name.includes("冷凍庫 A"))!;
    const baseline = await api<{ items: Array<{ locationId: number; locationCode: string; batchId: number; batchNo: string; systemQty: number; product: { name: string; unit: string } }> }>(page, "GET", `/stocktakes/baseline?warehouseId=${whA.id}`);
    const target = baseline.items.find((b) => b.systemQty >= 4)!;
    const good = target.systemQty - 3;
    const { unit } = target.product;

    await page.goto("/stocktake");
    await page.getByRole("button", { name: "＋ 新盤點" }).click();
    await selectByText(page.locator("select").first(), "冷凍庫 A");
    await page.getByLabel(`${target.locationCode} 實盤數量`).fill(String(good));
    await expect(page.getByRole("button", { name: `${target.locationCode} 建立報損` })).toHaveCount(0); // 還沒選「腐爛／損壞」
    await page.getByRole("radio", { name: "腐爛／損壞，無法販售" }).click();
    await page.getByRole("button", { name: `${target.locationCode} 建立報損` }).click();

    // 報損畫面：商品、批次、儲位、數量、原因都帶好了
    await expect(page.getByRole("heading", { name: "從盤點建立報損" })).toBeVisible();
    await expect(page.getByText(target.product.name, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(`批次 ${target.batchNo}`).first()).toBeVisible();
    await expect(page.getByText("（從盤點帶入）")).toBeVisible();
    await expect(page.getByLabel("報損數量")).toHaveValue("3");
    await expect(page.getByRole("button", { name: "腐爛", exact: true })).toHaveClass(/btn-primary/);
    // 報損不能超過盤點少掉的數量
    await page.getByLabel("報損數量").fill("4");
    await expect(page.getByRole("button", { name: "下一步：核對並報損" })).toBeDisabled();
    await page.getByLabel("報損數量").fill("3");
    await page.getByRole("button", { name: "下一步：核對並報損" }).click();
    await page.getByRole("button", { name: "確認報損" }).click();

    // 回到盤點：同一張草稿，這一格系統數量已扣完 → 相符，不用再選原因
    await expect(page.getByText(/已報損 .+ 3 .+庫存已扣除/)).toBeVisible();
    await expect(page.getByText(`✓ 盤點中已報損 3 ${unit}`)).toBeVisible();
    await expect(page.getByLabel(`${target.locationCode} 實盤數量`)).toHaveValue(String(good));
    await expect(page.getByText("請選擇差異原因：")).toHaveCount(0);
    const submit = page.getByRole("button", { name: "提交盤點" });
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(page.getByRole("dialog")).toContainText("盤點中已報損 1 筆");
    await page.getByTestId("dialog-confirm").click();
    await expect(page.getByText(/已提交，等待管理員核准/)).toBeVisible();
    await expect(page.getByText("盤點中已報損 1 筆").first()).toBeVisible();

    // 管理員核准：0 筆調整
    const ctx = await browser.newContext();
    const adminPage = await ctx.newPage();
    await pairAndLogin(adminPage, "admin");
    await adminPage.goto("/stocktake");
    await adminPage.getByRole("button", { name: "看明細" }).first().click();
    await expect(adminPage.getByText(/盤點中已報損（報損時已扣庫存/)).toBeVisible();
    await adminPage.getByRole("button", { name: "核准" }).first().click();
    await adminPage.getByTestId("dialog-confirm").click();
    await expect(adminPage.getByText(/已核准，產生 0 筆調整/)).toBeVisible();

    // 庫存：只扣 3（報損一次），沒有盤點調整
    const loc = await api<{ lines: Array<{ batch: { id: number }; quantity: number }> }>(page, "GET", `/locations/${target.locationId}`);
    expect(loc.lines.find((l) => l.batch.id === target.batchId)?.quantity).toBe(good);
    const dmg = await api<{ items: Array<{ quantity: number; reason: string }> }>(page, "GET", `/movements?type=DAMAGE&batchId=${target.batchId}`);
    expect(dmg.items).toHaveLength(1);
    expect(dmg.items[0]).toMatchObject({ quantity: 3, reason: "腐爛（盤點時發現）" });
    expect((await api<{ items: unknown[] }>(page, "GET", `/movements?type=ADJUSTMENT&batchId=${target.batchId}`)).items).toHaveLength(0);
    await ctx.close();
  });

  test("平常仍可直接進報損頁，不需要先盤點", async ({ page }) => {
    await pairAndLogin(page, "staff");
    await page.goto("/damage");
    await expect(page.getByRole("heading", { name: "報損", exact: true })).toBeVisible();
    await expect(page.getByText("哪個儲位的貨？")).toBeVisible();
    await expect(page.getByText("（從盤點帶入）")).toHaveCount(0);
  });
});
