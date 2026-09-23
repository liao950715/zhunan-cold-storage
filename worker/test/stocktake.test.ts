import { beforeEach, describe, expect, it } from "vitest";
import { Client, loginAs, locationIdByCode, locQty, movements, productByName } from "./helpers.js";

let staff: Client;
let admin: Client;
let batchId: number;
let A0103: number, A0104: number;

describe("FR-015 盤點與核准、FR-017 Dashboard", () => {
  beforeEach(async () => {
    staff = await loginAs("staff");
    admin = await loginAs("admin");
    const p = await productByName(staff, "甘藍菜");
    A0103 = await locationIdByCode(staff, "A-01-03");
    A0104 = await locationIdByCode(staff, "A-01-04");
    batchId = (await staff.post("/api/stock/inbound", { productId: p.id, quantity: 30, expiryDate: "2026-12-31", allocations: [{ locationId: A0103, quantity: 20 }, { locationId: A0104, quantity: 10 }] }).expect(201)).body.batch.id;
  });
  const submit = () => staff.post("/api/stocktakes", { items: [{ locationId: A0103, batchId, countedQty: 18 }, { locationId: A0104, batchId, countedQty: 10 }] });

  it("AT-21：工作人員提交盤點 → 待核准單，系統基準記錄，不改庫存", async () => {
    const r = await submit();
    expect(r.status).toBe(201);
    expect(r.body.status).toBe("PENDING");
    expect(r.body.items[0]).toMatchObject({ systemQty: 20, countedQty: 18, diff: -2 });
    expect(await locQty(staff, A0103)).toBe(20);
    expect((await staff.get("/api/dashboard")).body.stats.pendingStocktakes).toBe(1);
  });

  it("AT-22：工作人員試圖核准／退回 → 403（後端擋）", async () => {
    const st = (await submit()).body;
    expect((await staff.post(`/api/stocktakes/${st.id}/approve`, {})).status).toBe(403);
    expect((await staff.post(`/api/stocktakes/${st.id}/reject`, {})).status).toBe(403);
    expect(await locQty(staff, A0103)).toBe(20);
  });

  it("AT-23：管理員核准 → 庫存變為實盤、產生 ADJUSTMENT；退回 → 不變；已處理不可再操作", async () => {
    const st = (await submit()).body;
    const a = await admin.post(`/api/stocktakes/${st.id}/approve`, { note: "確認" });
    expect(a.status).toBe(200);
    expect(a.body.adjustments).toBe(1);
    expect(await locQty(staff, A0103)).toBe(18);
    const adj = (await movements(staff, "&type=ADJUSTMENT")).items[0];
    expect(adj).toMatchObject({ quantity: 2, fromBeforeQty: 20, fromAfterQty: 18, referenceType: "STOCKTAKE", referenceId: st.id });
    expect((await admin.post(`/api/stocktakes/${st.id}/approve`, {})).status).toBe(409);

    const st2 = (await staff.post("/api/stocktakes", { items: [{ locationId: A0103, batchId, countedQty: 5 }] })).body;
    await admin.post(`/api/stocktakes/${st2.id}/reject`, { note: "數字有誤" }).expect(200);
    expect(await locQty(staff, A0103)).toBe(18);
    expect((await staff.get(`/api/stocktakes/${st2.id}`)).body.status).toBe("REJECTED");
  });

  it("AT-24：提交後庫存又改變 → 核准時 409 STOCKTAKE_CONFLICT，庫存不變、單子仍待核准", async () => {
    const st = (await submit()).body;
    const p = await productByName(staff, "甘藍菜");
    await staff.post("/api/stock/outbound", { productId: p.id, lines: [{ batchId, locationId: A0103, quantity: 1 }] }).expect(201);
    const a = await admin.post(`/api/stocktakes/${st.id}/approve`, {});
    expect(a.status).toBe(409);
    expect(a.body.error.code).toBe("STOCKTAKE_CONFLICT");
    expect(a.body.error.details.conflicts[0]).toMatchObject({ locationCode: "A-01-03", systemQty: 20, current: 19 });
    expect(await locQty(staff, A0103)).toBe(19);
    expect((await staff.get(`/api/stocktakes/${st.id}`)).body.status).toBe("PENDING");
  });

  it("盤點基準 API 回傳目前有貨的儲位×批次", async () => {
    const r = await staff.get("/api/stocktakes/baseline");
    expect(r.body.items.length).toBeGreaterThanOrEqual(2);
    expect(r.body.items.find((i: any) => i.locationCode === "A-01-03")).toMatchObject({ systemQty: 20 });
  });

  it("I-8／FR-017：Dashboard 依單位分組、效期與低庫存提醒", async () => {
    const r = await staff.get("/api/dashboard");
    expect(r.status).toBe(200);
    expect(r.body.totalsByUnit).toEqual(expect.arrayContaining([{ unit: "籠", quantity: 30 }]));
    expect(r.body.expiryAlerts.map((a: any) => a.product.name)).toContain("草莓"); // 3 天後到期，提醒 7 天
    expect(r.body.expiryAlerts.find((a: any) => a.product.name === "草莓")).toMatchObject({ quantity: 6, expired: false });
    expect(r.body.lowStock.map((l: any) => l.name)).toContain("草莓"); // 6 ≤ 10
    expect(r.body.lowStock.map((l: any) => l.name)).not.toContain("甘藍菜"); // 30 > 10
    expect(r.body.stats.occupiedLocations).toBeGreaterThan(0);
  });
});
