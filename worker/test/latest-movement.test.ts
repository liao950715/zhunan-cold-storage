import { describe, expect, it } from "vitest";
import { loginAs, locationIdByCode, productByName } from "./helpers.js";

/**
 * I-23：平面圖儲位卡片「最近一筆異動紀錄」沿用 GET /api/movements?locationId=&limit=1（不另建資料來源）。
 * 依時間新到舊；示範資料的入庫紀錄時間＝該批進貨時間（模擬歷史），所以後來的實際操作一定排在前面。
 */
describe("I-23 儲位最近一筆異動", () => {
  it("依儲位取最新一筆：入庫 → 搬出／搬入 → 出庫 → 報損 → 盤點調整（附原因）；沒用過的儲位沒有紀錄", async () => {
    const staff = await loginAs("staff");
    const admin = await loginAs("admin");
    const A0103 = await locationIdByCode(staff, "A-01-03");
    const A0104 = await locationIdByCode(staff, "A-01-04");
    const latest = async (locationId: number) => (await staff.get(`/api/movements?locationId=${locationId}&limit=1`).expect(200)).body.items as Array<Record<string, any>>;
    expect(await latest(A0103)).toEqual([]);

    const p = await productByName(staff, "甘藍菜");
    const batchId = (await staff.post("/api/stock/inbound", { productId: p.id, quantity: 10, expiryDate: "2099-12-31", allocations: [{ locationId: A0103, quantity: 10 }] }).expect(201)).body.batch.id;
    expect((await latest(A0103))[0]).toMatchObject({ type: "IN", quantity: 10, toLocationId: A0103, productNameSnapshot: "甘藍菜" });

    await staff.post("/api/stock/transfer", { batchId, fromLocationId: A0103, toLocationId: A0104, quantity: 3 }).expect(201);
    expect((await latest(A0103))[0]).toMatchObject({ type: "TRANSFER", quantity: 3, fromLocationId: A0103, toLocationId: A0104 });
    expect((await latest(A0104))[0]).toMatchObject({ type: "TRANSFER", quantity: 3, toLocationId: A0104 });

    await staff.post("/api/stock/outbound", { productId: p.id, lines: [{ batchId, locationId: A0104, quantity: 1 }] }).expect(201);
    expect((await latest(A0104))[0]).toMatchObject({ type: "OUT", quantity: 1, fromLocationId: A0104 });
    expect((await latest(A0103))[0].type).toBe("TRANSFER"); // 別的儲位的異動不影響

    await staff.post("/api/stock/damage", { batchId, locationId: A0103, quantity: 1, reason: "腐爛（盤點時發現）" }).expect(201);
    expect((await latest(A0103))[0]).toMatchObject({ type: "DAMAGE", quantity: 1, fromLocationId: A0103, reason: "腐爛（盤點時發現）" });

    const st = (await staff.post("/api/stocktakes", { items: [{ locationId: A0103, batchId, systemQty: 6, countedQty: 5, reasonCode: "DAMAGED" }] }).expect(201)).body;
    await admin.post(`/api/stocktakes/${st.id}/approve`, { note: "確認" }).expect(200);
    const adj = (await latest(A0103))[0];
    expect(adj).toMatchObject({ type: "ADJUSTMENT", quantity: 1, fromLocationId: A0103 });
    expect(adj.reason).toMatch(/・原因：腐爛／損壞，無法販售・審核備註：確認$/); // 前端取「・原因：」後面那段顯示
  });

  it("示範資料的入庫紀錄時間＝該批進貨時間；之後的實際操作排在它前面", async () => {
    const staff = await loginAs("staff");
    const A0101 = await locationIdByCode(staff, "A-01-01");
    const line = (await staff.get(`/api/locations/${A0101}`).expect(200)).body.lines[0];
    const seeded = (await staff.get(`/api/movements?locationId=${A0101}&limit=1`).expect(200)).body.items[0];
    expect(seeded).toMatchObject({ type: "IN", reason: "示範資料", createdAt: line.batch.receivedAt });
    expect(Date.parse(seeded.createdAt)).toBeLessThan(Date.now() - 86_400_000);

    const carrot = await productByName(staff, "紅蘿蔔");
    await staff.post("/api/stock/outbound", { productId: carrot.id, lines: [{ batchId: line.batch.id, locationId: A0101, quantity: 1 }] }).expect(201);
    expect((await staff.get(`/api/movements?locationId=${A0101}&limit=1`).expect(200)).body.items[0]).toMatchObject({ type: "OUT", quantity: 1 });
  });
});
