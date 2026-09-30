import { expect, test } from "@playwright/test";
import { api, clickCell, locationIdByCode, productByName, selectByText } from "../e2e/helpers";
import { demoNote, login, occupied, quickInbound } from "./helpers";

/**
 * 示範站主要功能（FR-001～FR-020 挑最重要的走一遍）＋「每個瀏覽器一份、重新整理就重置、重置按鈕」。
 * 每個測試是新的瀏覽器 → 各自一份全新的示範資料（42 格有 39 格有貨；空位 A-04-05、A-04-06、B-03-06）。
 */
test.describe("示範站主要功能", () => {
  test("免同步碼：打開網址直接到登入頁、看得到示範帳號；登入後每頁都有示範說明與「重置示範資料」", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
    await expect(demoNote(page)).toContainText("admin／admin1234");
    await login(page, "staff");
    await expect(demoNote(page)).toContainText("重新整理");
    await expect(demoNote(page).getByRole("button", { name: "重置示範資料" })).toBeVisible();
  });

  test("首頁需要處理：已過期、即將到期；庫存概況 39 / 42，不同單位分開計算（FR-017／018）", async ({ page }) => {
    await login(page, "admin");
    await expect(page.getByText("已過期 2 批")).toBeVisible();
    await expect(page.getByText(/即將到期 \d+ 批/)).toBeVisible();
    await expect(page.getByText("39 / 42")).toBeVisible();
    await expect(page.getByText(/\d+ 箱・\d+ 公斤/)).toBeVisible();
  });

  test("找貨：搜尋青江菜 → 兩個位置 → 在 B 庫平面圖標出來（FR-019）", async ({ page }) => {
    await login(page, "staff");
    await page.goto("/inventory");
    await page.getByLabel("搜尋商品或儲位").fill("青江菜");
    await page.getByRole("button", { name: "找貨" }).click();
    await expect(page.getByText("B-03-04").first()).toBeVisible();
    await expect(page.getByText("B-03-05").first()).toBeVisible();
    await page.getByRole("link", { name: /在 B 庫平面圖標出位置/ }).click();
    await expect(page).toHaveURL(/floorplan\?warehouse=B&highlight=/);
    await expect(page.getByText("搜尋結果").first()).toBeVisible();
  });

  test("平面圖：點儲位看內容與操作；可進入貨架配置編輯（FR-005）", async ({ page }) => {
    await login(page, "staff");
    await page.goto("/floorplan?warehouse=A");
    await expect(page.locator(".konvajs-content")).toBeVisible();
    await clickCell(page, "A-01-01");
    await expect(page.getByRole("heading", { name: "A-01-01" })).toBeVisible();
    await expect(page.getByText("甘藍菜").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "從這裡取貨（出庫）" })).toBeVisible();
    await page.getByRole("button", { name: "調整貨架配置（管理用）" }).click();
    await expect(page.getByText("正在調整貨架配置")).toBeVisible();
  });

  test("日常作業一輪：入庫 30 分兩儲位 → 搬移 5 → 先進先出出庫（過期不安排）→ 直接報損（FR-008～014）", async ({ page }) => {
    await login(page, "staff");
    const cabbage = await productByName(page, "甘藍菜");
    const before = (await api<{ total: number }>(page, "GET", `/products/${cabbage.id}/stock`)).total;

    // 入庫 30：A-04-05 20＋A-04-06 10（兩格空位）
    await page.goto("/inbound");
    await page.getByRole("radio", { name: /甘藍菜/ }).click();
    await expect(page.getByText("目前選擇：甘藍菜")).toBeVisible();
    await page.getByLabel("數量").fill("30");
    await page.getByRole("button", { name: "30 天後" }).click();
    await page.getByRole("button", { name: "分到其他儲位" }).click();
    const selects = page.getByRole("combobox", { name: "儲位", exact: true });
    await selectByText(selects.nth(0), "A-04-05");
    await selectByText(selects.nth(1), "A-04-06");
    await page.getByLabel("第 1 個儲位數量").fill("20");
    await page.getByLabel("第 2 個儲位數量").fill("10");
    await page.getByRole("button", { name: "下一步：核對並入庫" }).click();
    await expect(page.getByText("甘藍菜，入庫 30 箱")).toBeVisible();
    await page.getByRole("button", { name: "確認入庫" }).click();
    await expect(page.getByText("✓ 入庫完成")).toBeVisible();
    await expect(page.getByText(/進貨時間：\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}（系統已記錄）/)).toBeVisible();
    expect((await api<{ total: number }>(page, "GET", `/products/${cabbage.id}/stock`)).total).toBe(before + 30);

    // 搬移 5：A-04-05 → A-04-06（同商品、容量 20 內）
    await page.goto(`/transfer?locationId=${await locationIdByCode(page, "A-04-05")}`);
    await expect(page.getByText("① 從這裡搬出").first()).toBeVisible();
    await page.getByLabel("搬移數量").fill("5");
    await page.getByRole("button", { name: "下一步：選搬到哪裡" }).click();
    await clickCell(page, "A-04-06");
    await expect(page.getByText(/從 A-04-05 → A-04-06/)).toBeVisible();
    await page.getByRole("button", { name: "確認搬移" }).click();
    await expect(page.getByText("✓ 搬移完成")).toBeVisible();
    expect(await occupied(page, "A-04-05")).toBe(15);
    expect(await occupied(page, "A-04-06")).toBe(15);

    // 出庫先進先出：青江菜 5 → 先拿較早進貨的 B-03-04 全部 4 箱，再從 B-03-05 拿 1 箱
    await page.goto("/outbound");
    await page.getByRole("radio", { name: /青江菜/ }).click();
    await page.getByLabel("出庫數量", { exact: true }).fill("5");
    await expect(page.getByText(/從 B-03-04 取 4 箱/)).toBeVisible();
    await expect(page.getByText(/從 B-03-05 取 1 箱/)).toBeVisible();
    await expect(page.getByText("最早入庫")).toBeVisible();
    await page.getByRole("button", { name: "下一步：核對並出庫" }).click();
    await expect(page.getByText("青江菜，出庫 5 箱")).toBeVisible();
    await page.getByRole("button", { name: "確認出庫" }).click();
    await expect(page.getByText("✓ 出庫完成")).toBeVisible();
    expect(await occupied(page, "B-03-04")).toBe(0);
    expect(await occupied(page, "B-03-05")).toBe(7);

    // 已過期的批次照列但不自動安排：草莓較早進貨的那批（B-01-05）已過期 → 改從 B-01-04 拿
    await page.goto("/outbound");
    await page.getByRole("radio", { name: /草莓/ }).click();
    await page.getByLabel("出庫數量", { exact: true }).fill("1");
    await expect(page.getByText(/從 B-01-04 取 1 箱/)).toBeVisible();
    await expect(page.getByText(/有 1 筆已過期（B-01-05），系統沒有安排出庫/)).toBeVisible();

    // 報損（平常直接進報損頁，不需要先盤點）
    await page.goto(`/damage?locationId=${await locationIdByCode(page, "A-04-06")}`);
    await expect(page.getByRole("heading", { name: "報損", exact: true })).toBeVisible();
    await page.getByLabel("報損數量").fill("1");
    await page.getByRole("button", { name: "壓損" }).click();
    await page.getByRole("button", { name: "下一步：核對並報損" }).click();
    await page.getByRole("button", { name: "確認報損" }).click();
    await expect(page.getByText("✓ 報損完成")).toBeVisible();
    expect(await occupied(page, "A-04-06")).toBe(14);
  });

  test("盤點發現過期腐爛 → 建立報損（自動帶入）→ 回到盤點 → 提交；換管理員核准，庫存只扣一次（FR-015）", async ({ page }) => {
    await login(page, "staff");
    await page.goto("/stocktake");
    await page.getByRole("button", { name: "＋ 新盤點" }).click();
    await selectByText(page.locator("select").first(), "冷凍庫 A");
    const expiredRow = page.locator('[id^="st-line-"]').filter({ hasText: "已過期，請檢查是否腐爛" });
    await expect(expiredRow).toHaveCount(1);
    await expect(expiredRow).toContainText("A-01-03");
    await expiredRow.getByRole("spinbutton").fill("0");
    await expiredRow.getByRole("radio", { name: "腐爛／損壞，無法販售" }).click();
    await expiredRow.getByRole("button", { name: "A-01-03 建立報損" }).click();

    await expect(page.getByRole("heading", { name: "從盤點建立報損" })).toBeVisible();
    await expect(page.getByLabel("報損數量")).toHaveValue("2");
    await page.getByRole("button", { name: "下一步：核對並報損" }).click();
    await page.getByRole("button", { name: "確認報損" }).click();

    await expect(page.getByText(/已報損 甘藍菜 2 箱/)).toBeVisible();
    await expect(expiredRow).toHaveCount(0); // 過期那批已全部報損，盤點清單不再列出
    await page.getByRole("button", { name: "提交盤點" }).click();
    await expect(page.getByRole("dialog")).toContainText("盤點中已報損 1 筆");
    await page.getByTestId("dialog-confirm").click();
    await expect(page.getByText(/已提交，等待管理員核准/)).toBeVisible();
    await expect(page.getByRole("button", { name: "核准" })).toHaveCount(0); // 工作人員不能核准

    // 同一個瀏覽器登出、換管理員（不重新整理，資料才會留著）
    await page.getByRole("button", { name: "登出" }).click();
    await login(page, "admin");
    await page.goto("/stocktake");
    await page.getByRole("button", { name: "看明細" }).first().click();
    await expect(page.getByText(/盤點中已報損（報損時已扣庫存/)).toBeVisible();
    await page.getByRole("button", { name: "核准" }).first().click();
    await page.getByTestId("dialog-confirm").click();
    await expect(page.getByText(/已核准，產生 0 筆調整/)).toBeVisible();
    expect(await occupied(page, "A-01-03")).toBe(18);
  });

  test("異動紀錄：工作人員看不到復原；管理員復原一筆報損，以反向紀錄加回（FR-016／020）", async ({ page }) => {
    await login(page, "staff");
    const loc = await locationIdByCode(page, "A-01-01");
    const line = (await api<{ lines: Array<{ batch: { id: number } }> }>(page, "GET", `/locations/${loc}`)).lines[0];
    await api(page, "POST", "/stock/damage", { batchId: line.batch.id, locationId: loc, quantity: 1, reason: "壓損" });
    await page.goto("/movements");
    await page.getByRole("button", { name: "報損", exact: true }).click();
    await expect(page.getByText(/共 1 筆/)).toBeVisible();
    await expect(page.getByRole("button", { name: "復原這筆操作" })).toHaveCount(0);

    await page.getByRole("button", { name: "登出" }).click();
    await login(page, "admin");
    await page.goto("/movements");
    await page.getByRole("button", { name: "報損", exact: true }).click();
    await page.getByRole("button", { name: "復原這筆操作" }).first().click();
    await expect(page.getByText("預計復原的庫存變化")).toBeVisible();
    await page.getByLabel("復原原因（必填）").fill("示範：登記錯誤");
    await page.getByRole("button", { name: "確認復原" }).click();
    await expect(page.getByText(/已復原紀錄 #\d+，新增反向紀錄/)).toBeVisible();
    expect(await occupied(page, "A-01-01")).toBe(20);
  });

  test("出庫：選好商品就預選「建議優先出庫」的位置 1 箱（每個商品都一樣）；數量、位置都還能改（FR-011／012）", async ({ page }) => {
    await login(page, "staff");
    await page.goto("/outbound");
    const qty = page.getByLabel("出庫數量", { exact: true });
    const recommended = page.locator("[data-recommended]");
    // 青江菜：9/18 進貨的 B-03-04 最早（先進先出）→ 直接是已選、1 箱
    await page.getByRole("radio", { name: /青江菜/ }).click();
    await expect(qty).toHaveValue("1");
    await expect(recommended).toContainText("從 B-03-04 取 1 箱");
    await expect(recommended).toContainText("✓ 已選");
    await expect(recommended).toContainText("建議優先出庫");
    // 其他商品也一樣：紅蘿蔔最早那批在 A-02-01；草莓較早那批已過期 → 建議 B-01-04；毛豆單位公斤
    for (const [name, code, unit] of [["紅蘿蔔", "A-02-01", "箱"], ["草莓", "B-01-04", "箱"], ["毛豆", "B-02-05", "公斤"]]) {
      await page.getByRole("radio", { name: new RegExp(name) }).click();
      await expect(qty).toHaveValue("1");
      await expect(recommended).toContainText(`從 ${code} 取 1 ${unit}`);
      await expect(recommended).toContainText("建議優先出庫");
    }
    // 可以改數量
    await page.getByRole("radio", { name: /青江菜/ }).click();
    await qty.fill("3");
    await expect(recommended).toContainText("從 B-03-04 取 3 箱");
    // 可以改選其他儲位：B-03-04 改 0、B-03-05 取 1 → 上面的數量跟著變成 1
    await page.getByRole("button", { name: "調整取貨位置或數量" }).click();
    await page.getByLabel("B-03-04 出庫數量").fill("0");
    await page.getByLabel("B-03-05 出庫數量").fill("1");
    await expect(qty).toHaveValue("1");
    await page.getByRole("button", { name: "完成調整" }).click();
    await expect(page.getByText(/從 B-03-05 取 1 箱/)).toBeVisible();
    await page.getByRole("button", { name: "下一步：核對並出庫" }).click();
    await expect(page.getByText("青江菜，出庫 1 箱")).toBeVisible();
    await page.getByRole("button", { name: "確認出庫" }).click();
    await expect(page.getByText("✓ 出庫完成")).toBeVisible();
    expect(await occupied(page, "B-03-04")).toBe(4);
    expect(await occupied(page, "B-03-05")).toBe(7);
    // 從首頁「優先出貨」連結進來（?productId=）也一樣預選
    const bokChoy = await productByName(page, "青江菜");
    await page.goto(`/outbound?productId=${bokChoy.id}`);
    await expect(qty).toHaveValue("1");
    await expect(recommended).toContainText("從 B-03-04 取 1 箱");
  });

  test("平面圖儲位卡片最下面：最近一筆異動（入庫 +2、盤點中報損 −1、出庫 −1、盤點調整附原因、沒有紀錄）", async ({ page }) => {
    const today = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10).replace(/-/g, "/");
    const now = new RegExp(`^${today} \\d{2}:\\d{2}$`);
    await login(page, "staff");

    // ① 青江菜入庫 2 箱到 A-04-05
    await page.goto("/inbound");
    await page.getByRole("radio", { name: /青江菜/ }).click();
    await page.getByLabel("數量").fill("2");
    await page.getByRole("button", { name: "30 天後" }).click();
    await selectByText(page.getByRole("combobox", { name: "儲位", exact: true }).first(), "A-04-05");
    await page.getByRole("button", { name: "下一步：核對並入庫" }).click();
    await expect(page.getByText("青江菜，入庫 2 箱")).toBeVisible();
    await page.getByRole("button", { name: "確認入庫" }).click();
    await expect(page.getByText("✓ 入庫完成")).toBeVisible();

    // ② A-01-03 甘藍菜：盤點發現 1 箱爛掉 → 建立報損 −1；同一張盤點另把 A-01-06 大白菜 12 → 11（直接盤點調整）
    await page.goto("/stocktake");
    await page.getByRole("button", { name: "＋ 新盤點" }).click();
    await selectByText(page.locator("select").first(), "冷凍庫 A");
    const a0103 = page.locator('[id^="st-line-"]').filter({ hasText: "已過期，請檢查是否腐爛" });
    await expect(a0103).toContainText("A-01-03");
    await a0103.getByRole("spinbutton").fill("1");
    await a0103.getByRole("radio", { name: "腐爛／損壞，無法販售" }).click();
    await a0103.getByRole("button", { name: "A-01-03 建立報損" }).click();
    await expect(page.getByLabel("報損數量")).toHaveValue("1");
    await page.getByRole("button", { name: "下一步：核對並報損" }).click();
    await page.getByRole("button", { name: "確認報損" }).click();
    await expect(page.getByText(/已報損 甘藍菜 1 箱/)).toBeVisible();
    const a0106 = page.locator('[id^="st-line-"]').filter({ hasText: "A-01-06" });
    await a0106.getByRole("spinbutton").fill("11");
    await a0106.getByRole("radio", { name: "腐爛／損壞，無法販售" }).click();
    await page.getByRole("button", { name: "提交盤點" }).click();
    await page.getByTestId("dialog-confirm").click();
    await expect(page.getByText(/已提交，等待管理員核准/)).toBeVisible();

    // ③ B-03-04 青江菜出庫 −1（選商品就預選 B-03-04 1 箱）
    await page.goto("/outbound");
    await page.getByRole("radio", { name: /青江菜/ }).click();
    await expect(page.locator("[data-recommended]")).toContainText("從 B-03-04 取 1 箱");
    await page.getByRole("button", { name: "下一步：核對並出庫" }).click();
    await page.getByRole("button", { name: "確認出庫" }).click();
    await expect(page.getByText("✓ 出庫完成")).toBeVisible();

    // 管理員核准：A-01-06 產生一筆盤點調整；A-01-03 報損時已扣過，不再調整
    await page.getByRole("button", { name: "登出" }).click();
    await login(page, "admin");
    await page.goto("/stocktake");
    await page.getByRole("button", { name: "核准" }).first().click();
    await page.getByTestId("dialog-confirm").click();
    await expect(page.getByText(/已核准，產生 1 筆調整/)).toBeVisible();

    // ④ 平面圖：點儲位，卡片最下面看最近一筆
    const lastOf = async (warehouse: "A" | "B", code: string) => {
      await page.goto(`/floorplan?warehouse=${warehouse}`);
      await expect(page.locator(".konvajs-content")).toBeVisible();
      await clickCell(page, code);
      await expect(page.getByRole("heading", { name: code, exact: true })).toBeVisible();
      return page.getByRole("region", { name: "最近一筆異動紀錄" });
    };
    await expect((await lastOf("A", "A-04-05")).locator("dd")).toHaveText(["入庫", "青江菜", "+2 箱", now]);
    await expect((await lastOf("A", "A-01-03")).locator("dd")).toHaveText(["報損", "甘藍菜", "−1 箱", "腐爛（盤點時發現）", now]);
    await expect((await lastOf("B", "B-03-04")).locator("dd")).toHaveText(["出庫", "青江菜", "−1 箱", now]);
    await expect((await lastOf("A", "A-01-06")).locator("dd")).toHaveText(["盤點調整", "大白菜", "−1 箱", "腐爛／損壞，無法販售", now]);
    // 沒動過的格子：示範資料的入庫，時間是那批的進貨時間（不是今天）
    const seeded = (await lastOf("A", "A-01-01")).locator("dd");
    await expect(seeded).toHaveText(["入庫", "甘藍菜", "+20 箱", /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/]);
    await expect(seeded.last()).not.toHaveText(now);
    // 從沒放過東西的空位
    await expect(await lastOf("B", "B-03-06")).toContainText("尚無異動紀錄");
  });

  test("商品管理：管理員看得到商品清單與「新增商品」（FR-002）", async ({ page }) => {
    await login(page, "admin");
    await page.goto("/products");
    await expect(page.getByRole("button", { name: "＋ 新增商品" })).toBeVisible();
    for (const name of ["甘藍菜", "青江菜", "毛豆", "草莓"]) await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  });
});

test.describe("示範站：每個瀏覽器一份、重新整理就重置", () => {
  test("同一個瀏覽器的新分頁共用資料；另一個瀏覽器看不到；按重新整理 → 回到初始示範資料，仍保持登入", async ({ page, browser }) => {
    await login(page, "staff");
    await quickInbound(page, "A-04-05", 5);
    expect(await occupied(page, "A-04-05")).toBe(5);

    const tab2 = await page.context().newPage();
    await tab2.goto("/");
    await expect(tab2.getByRole("heading", { name: "首頁" })).toBeVisible();
    expect(await occupied(tab2, "A-04-05")).toBe(5);

    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await login(otherPage, "staff");
    expect(await occupied(otherPage, "A-04-05")).toBe(0);
    await other.close();

    await page.reload();
    await expect(page.getByRole("heading", { name: "首頁" })).toBeVisible();
    expect(await occupied(page, "A-04-05")).toBe(0);
    expect(await occupied(tab2, "A-04-05")).toBe(0); // 同一個瀏覽器的分頁一起回到初始
  });

  test("「重置示範資料」按鈕：確認後回到首頁與初始資料（手機或安裝成 App 沒有重新整理鍵也能用）", async ({ page }) => {
    await login(page, "staff");
    await quickInbound(page, "A-04-05", 5);
    await page.goto("/inventory");
    await demoNote(page).getByRole("button", { name: "重置示範資料" }).click();
    await expect(page.getByRole("dialog")).toContainText("其他人的資料不受影響");
    await page.getByTestId("dialog-confirm").click();
    await expect(page.getByRole("heading", { name: "首頁" })).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
    expect(await occupied(page, "A-04-05")).toBe(0);
  });

  test("PWA 與 API：manifest、service worker、健康檢查、直接開內頁網址", async ({ request }) => {
    expect((await request.get("/api/health")).ok()).toBe(true);
    const manifest = await request.get("/manifest.webmanifest");
    expect(manifest.ok()).toBe(true);
    expect(await manifest.json()).toMatchObject({ name: "竹南冷凍倉儲庫存管理系統" });
    expect((await request.get("/sw.js")).ok()).toBe(true);
    const deep = await request.get("/stocktake");
    expect(deep.ok()).toBe(true);
    expect(deep.headers()["content-type"]).toContain("text/html");
  });
});
