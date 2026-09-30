import { expect, test } from "@playwright/test";
import { api, locationIdByCode, pairAndLogin, productByName, resetDemo, selectByText } from "./helpers";

/**
 * 2026-09-30 老師驗收流程（全部走 UI）：
 * 選甘藍菜 → 入庫 2 箱（看得到進貨時間、到期日三種情況）→ 出庫時改「從哪裡拿」總數自動同步
 * → 盤點：一致不要原因、不一致要原因 → 選「腐爛／損壞」→ 核准後庫存正確。
 */
const taipeiDay = (offset: number) => new Date(Date.now() + 8 * 3_600_000 + offset * 86_400_000).toISOString().slice(0, 10);
const slash = (d: string) => d.replace(/-/g, "/");

test.describe.serial("老師驗收流程", () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await resetDemo(page);
    await page.close();
  });

  test("入庫：選商品顯示「目前選擇」、進貨時間看得到、到期日昨天擋／今天警告／之後可入庫", async ({ page }) => {
    await pairAndLogin(page, "admin");
    await page.goto("/inbound");
    await expect(page.getByText("目前選擇：尚未選擇")).toBeVisible();
    await page.getByRole("radio", { name: /甘藍菜/ }).click();
    await expect(page.getByText("目前選擇：甘藍菜")).toBeVisible();
    await expect(page.getByText("（單位：箱）", { exact: true })).toBeVisible();
    await page.getByLabel("數量").fill("2");
    await expect(page.getByText(new RegExp(`進貨時間：${slash(taipeiDay(0))} \\d{2}:\\d{2}`))).toBeVisible();
    await selectByText(page.getByRole("combobox", { name: "儲位", exact: true }).first(), "A-01-03");

    const next = page.getByRole("button", { name: "下一步：核對並入庫" });
    // 1. 昨天到期 → 擋
    await page.getByLabel("到期日").fill(taipeiDay(-1));
    await expect(page.getByText("此商品已過期，無法入庫，請確認到期日。").first()).toBeVisible();
    await expect(next).toBeDisabled();
    // 2. 今天到期 → 警告但可以繼續
    await page.getByLabel("到期日").fill(taipeiDay(0));
    await expect(page.getByText("此商品今天到期，請確認是否仍要入庫。").first()).toBeVisible();
    await expect(next).toBeEnabled();
    // 3. 明天到期 → 正常
    await page.getByLabel("到期日").fill(taipeiDay(1));
    await expect(page.getByText("此商品今天到期")).toHaveCount(0);
    await expect(page.getByText("此商品已過期")).toHaveCount(0);
    await next.click();
    await expect(page.getByText("甘藍菜，入庫 2 箱")).toBeVisible();
    await expect(page.getByText(/進貨時間：/)).toBeVisible();
    await page.getByRole("button", { name: "確認入庫" }).click();
    await expect(page.getByText("✓ 入庫完成")).toBeVisible();
    await expect(page.getByText(new RegExp(`進貨時間：${slash(taipeiDay(0))} \\d{2}:\\d{2}（系統已記錄）`))).toBeVisible();
    expect((await api(page, "GET", `/locations/${await locationIdByCode(page, "A-01-03")}`)).occupied).toBe(2);
  });

  test("補登進貨時間（日期＋時分）→ 出庫先進先出：先拿最早進貨的那批，並顯示時分", async ({ page }) => {
    await pairAndLogin(page, "admin");
    await page.goto("/inbound");
    await page.getByRole("radio", { name: /甘藍菜/ }).click();
    await page.getByLabel("數量").fill("1");
    await page.getByRole("button", { name: "貨是之前到的？補登進貨時間" }).click();
    await page.getByLabel("進貨日期").fill(taipeiDay(-1));
    await page.getByLabel("進貨時間（時分）").fill("09:30");
    await expect(page.getByText(`進貨時間：${slash(taipeiDay(-1))} 09:30（補登）`)).toBeVisible();
    await selectByText(page.getByRole("combobox", { name: "儲位", exact: true }).first(), "A-01-04");
    await page.getByRole("button", { name: "下一步：核對並入庫" }).click();
    await page.getByRole("button", { name: "確認入庫" }).click();
    await expect(page.getByText(`進貨時間：${slash(taipeiDay(-1))} 09:30（系統已記錄）`)).toBeVisible();

    // A-01-03 是剛剛（今天）進的 2 箱，A-01-04 是昨天 09:30 補登的 1 箱 → 先進先出要先拿 A-01-04
    await page.goto("/outbound");
    await page.getByRole("radio", { name: /甘藍菜/ }).click();
    await page.getByLabel("出庫數量", { exact: true }).fill("1");
    await expect(page.getByText(/從 A-01-04 取 1 箱/)).toBeVisible();
    await expect(page.getByText("最早入庫")).toBeVisible();
    await expect(page.getByText(`進貨 ${slash(taipeiDay(-1))} 09:30`).first()).toBeVisible();
    await page.getByRole("button", { name: "下一步：核對並出庫" }).click();
    await page.getByRole("button", { name: "確認出庫" }).click();
    await expect(page.getByText("✓ 出庫完成")).toBeVisible();
    expect((await api(page, "GET", `/locations/${await locationIdByCode(page, "A-01-04")}`)).occupied).toBe(0);
    expect((await api(page, "GET", `/locations/${await locationIdByCode(page, "A-01-03")}`)).occupied).toBe(2);
  });

  test("後端也擋：直接呼叫 API 送昨天到期 → 400，庫存不變", async ({ page }) => {
    await pairAndLogin(page, "admin");
    const cabbage = await productByName(page, "甘藍菜");
    const loc = await locationIdByCode(page, "A-01-03");
    const res = await page.request.post("/api/stock/inbound", { data: { productId: cabbage.id, quantity: 1, expiryDate: taipeiDay(-1), allocations: [{ locationId: loc, quantity: 1 }] } });
    expect(res.status()).toBe(400);
    expect((await res.json()).error.code).toBe("EXPIRED_ON_ARRIVAL");
    expect((await api(page, "GET", `/locations/${loc}`)).occupied).toBe(2);
  });

  test("出庫：改「從哪裡拿」的數量，上面的出庫數量自動等於合計，實際扣除一致", async ({ page }) => {
    await pairAndLogin(page, "admin");
    const carrot = await productByName(page, "紅蘿蔔");
    const before = (await api(page, "GET", `/products/${carrot.id}/stock`)).total;
    await page.goto("/outbound");
    await page.getByRole("radio", { name: /紅蘿蔔/ }).click();
    await page.getByLabel("出庫數量", { exact: true }).fill("2");
    await expect(page.getByText(/從 A-01-01 取 2 箱/)).toBeVisible();
    // 有這個商品的儲位全部直接列出、每格都能填數量（不用先按「調整」或點平面圖）
    await expect(page.getByLabel("A-01-02 出庫數量")).toHaveValue("");
    await page.getByLabel("A-01-01 出庫數量").fill("1");
    await expect(page.getByLabel("出庫數量", { exact: true })).toHaveValue("1");
    await page.getByLabel("A-01-02 出庫數量").fill("2");
    await expect(page.getByLabel("出庫數量", { exact: true })).toHaveValue("3");
    await expect(page.getByText("合計 3 箱")).toBeVisible();
    // 超過該儲位現有數量 → 自動限制在上限，不會出現負數或超額
    await page.getByLabel("A-01-02 出庫數量").fill("999");
    await expect(page.getByLabel("A-01-02 出庫數量")).toHaveValue("8");
    await expect(page.getByLabel("出庫數量", { exact: true })).toHaveValue("9");
    await page.getByLabel("A-01-02 出庫數量").fill("2");
    await expect(page.getByLabel("出庫數量", { exact: true })).toHaveValue("3");
    await page.getByRole("button", { name: "下一步：核對並出庫" }).click();
    await expect(page.getByText("紅蘿蔔，出庫 3 箱")).toBeVisible();
    await expect(page.getByText(/進貨 \d{4}\/\d{2}\/\d{2}/).first()).toBeVisible();
    await page.getByRole("button", { name: "確認出庫" }).click();
    await expect(page.getByText("✓ 出庫完成")).toBeVisible();
    expect((await api(page, "GET", `/products/${carrot.id}/stock`)).total).toBe(before - 3);
  });

  test("盤點冷凍庫 A：一致不要原因；甘藍菜 2→1 要選原因，選「腐爛／損壞」核准後庫存為 1", async ({ page }) => {
    await pairAndLogin(page, "admin");
    await page.goto("/stocktake");
    await page.getByRole("button", { name: "＋ 新盤點" }).click();
    await selectByText(page.locator("select").first(), "冷凍庫 A");
    await expect(page.getByText(/請逐格填實盤數量/)).toBeVisible();
    const submit = page.getByRole("button", { name: "提交盤點" });
    await expect(submit).toBeEnabled(); // 全部一致 → 不需要原因
    await expect(page.getByText("請選擇差異原因：")).toHaveCount(0);

    await page.getByLabel("A-01-03 實盤數量").fill("1");
    await expect(page.getByText("差異 -1 箱").first()).toBeVisible();
    await expect(page.getByText("請選擇差異原因：")).toBeVisible();
    await expect(submit).toBeDisabled();
    await page.getByRole("radio", { name: "腐爛／損壞，無法販售" }).click();
    await expect(submit).toBeEnabled();
    await submit.click();
    await page.getByTestId("dialog-confirm").click();
    await expect(page.getByText(/已提交，等待管理員核准/)).toBeVisible();

    await page.getByRole("button", { name: "核准" }).first().click();
    await page.getByTestId("dialog-confirm").click();
    await expect(page.getByText(/已核准，產生 1 筆調整/)).toBeVisible();
    await page.getByRole("button", { name: "看明細" }).first().click();
    await expect(page.getByText("原因：腐爛／損壞，無法販售").first()).toBeVisible();
    expect((await api(page, "GET", `/locations/${await locationIdByCode(page, "A-01-03")}`)).occupied).toBe(1);
  });
});
