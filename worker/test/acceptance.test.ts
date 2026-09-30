/** 2026-09-30 老師驗收流程調整：I-15 到期日驗證、I-16 盤點差異原因、I-17 進貨時間可見 */
import { beforeEach, describe, expect, it } from "vitest";
import { Client, loginAs, locationIdByCode, locQty, movements, productByName } from "./helpers.js";

const taipeiDay = (offset: number) => new Date(Date.now() + 8 * 3_600_000 + offset * 86_400_000).toISOString().slice(0, 10);

let staff: Client;
let admin: Client;
let A0103: number;
let cabbageId: number;

describe("驗收流程調整", () => {
  beforeEach(async () => {
    staff = await loginAs("staff");
    admin = await loginAs("admin");
    A0103 = await locationIdByCode(staff, "A-01-03");
    cabbageId = (await productByName(staff, "甘藍菜")).id;
  });
  const inbound = (expiryDate: string, quantity = 2) => staff.post("/api/stock/inbound", { productId: cabbageId, quantity, expiryDate, allocations: [{ locationId: A0103, quantity }] });

  it("I-15a：昨天到期 → 400 EXPIRED_ON_ARRIVAL，庫存與紀錄都不變", async () => {
    const before = (await movements(staff)).total;
    const r = await inbound(taipeiDay(-1));
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("EXPIRED_ON_ARRIVAL");
    expect(r.body.error.message).toContain("此商品已過期，無法入庫");
    expect(await locQty(staff, A0103)).toBe(0);
    expect((await movements(staff)).total).toBe(before);
  });

  it("I-15b：今天到期 → 允許入庫（前端負責警告）；明天到期 → 正常入庫", async () => {
    await inbound(taipeiDay(0)).expect(201);
    await inbound(taipeiDay(1)).expect(201);
    expect(await locQty(staff, A0103)).toBe(4);
  });

  it("I-17：入庫回傳並記錄進貨日期與系統時間；庫存明細、出庫建議、盤點基準都帶得到", async () => {
    const r = (await inbound(taipeiDay(30))).body;
    expect(r.batch.receivedDate).toBe(taipeiDay(0));
    expect(r.batch.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    const stock = (await staff.get(`/api/products/${cabbageId}/stock`)).body;
    expect(stock.lines[0].batch).toMatchObject({ receivedDate: taipeiDay(0), createdAt: r.batch.createdAt });
    const sug = (await staff.post("/api/stock/outbound/suggest", { productId: cabbageId, quantity: 1 })).body;
    expect(sug.suggestions[0]).toMatchObject({ receivedDate: taipeiDay(0) });
    const base = (await staff.get("/api/stocktakes/baseline")).body.items.find((b: any) => b.batchId === r.batch.id);
    expect(base).toMatchObject({ receivedDate: taipeiDay(0) });
  });

  describe("I-16：盤點差異原因", () => {
    let batchId: number;
    beforeEach(async () => { batchId = (await inbound(taipeiDay(30), 10)).body.batch.id; });

    it("數量一致 → 不需要原因", async () => {
      const st = (await staff.post("/api/stocktakes", { items: [{ locationId: A0103, batchId, countedQty: 10, systemQty: 10 }] }).expect(201)).body;
      expect(st.items[0]).toMatchObject({ diff: 0, reasonCode: null, reason: null });
    });

    it("數量不一致但沒選原因 → 400 STOCKTAKE_REASON_REQUIRED；選「其他」沒寫說明也不行", async () => {
      const a = await staff.post("/api/stocktakes", { items: [{ locationId: A0103, batchId, countedQty: 9, systemQty: 10 }] });
      expect(a.status).toBe(400);
      expect(a.body.error.code).toBe("STOCKTAKE_REASON_REQUIRED");
      const b = await staff.post("/api/stocktakes", { items: [{ locationId: A0103, batchId, countedQty: 9, systemQty: 10, reasonCode: "OTHER" }] });
      expect(b.status).toBe(400);
      expect((await staff.get("/api/stocktakes")).body.items).toHaveLength(0);
    });

    it("10 → 9 選「腐爛／損壞」→ 核准後庫存 9，盤點單與異動紀錄都看得到原因", async () => {
      const st = (await staff.post("/api/stocktakes", { items: [{ locationId: A0103, batchId, countedQty: 9, systemQty: 10, reasonCode: "DAMAGED" }] }).expect(201)).body;
      expect(st.items[0]).toMatchObject({ systemQty: 10, countedQty: 9, diff: -1, reasonCode: "DAMAGED", reason: "腐爛／損壞，無法販售" });
      await admin.post(`/api/stocktakes/${st.id}/approve`, {}).expect(200);
      expect(await locQty(staff, A0103)).toBe(9);
      const adj = (await movements(staff, "&type=ADJUSTMENT")).items[0];
      expect(adj.reason).toContain("腐爛／損壞");
      expect(adj.quantity).toBe(1);
    });
  });
});
