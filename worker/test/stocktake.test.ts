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
  const submit = () => staff.post("/api/stocktakes", { items: [{ locationId: A0103, batchId, countedQty: 18, reasonCode: "DAMAGED" }, { locationId: A0104, batchId, countedQty: 10 }] });

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

    const st2 = (await staff.post("/api/stocktakes", { items: [{ locationId: A0103, batchId, countedQty: 5, reasonCode: "DAMAGED" }] })).body;
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
    expect(r.body.totalsByUnit).toEqual(expect.arrayContaining([{ unit: "箱", quantity: 74 }, { unit: "公斤", quantity: 15 }])); // 甘藍菜 30 箱＋種子 44 箱；公斤另計，不相加
    expect(r.body.expiryAlerts.map((a: any) => a.product.name)).toContain("草莓"); // 3 天後到期，提醒 7 天
    expect(r.body.expiryAlerts.find((a: any) => a.product.name === "草莓")).toMatchObject({ quantity: 6, expired: false });
    expect(r.body.lowStock.map((l: any) => l.name)).toContain("草莓"); // 6 ≤ 10
    expect(r.body.lowStock.map((l: any) => l.name)).not.toContain("甘藍菜"); // 30 > 10
    expect(r.body.stats.occupiedLocations).toBeGreaterThan(0);
  });
});

/**
 * I-20（2026-09-30）：盤點時發現腐爛／損壞 → 「建立報損」。
 * 報損當下就扣庫存，盤點基準跟著變成扣完的數字；核准時只調剩下的差異 → 同一批貨不會在報損與盤點各扣一次。
 */
describe("I-20 盤點中建立報損：庫存只扣一次", () => {
  const baselineQty = async (c: Client, locationId: number) =>
    ((await c.get("/api/stocktakes/baseline")).body.items.find((i: any) => i.locationId === locationId && i.batchId === batchId)?.systemQty ?? 0) as number;
  const batchMovements = async (type: string) => (await movements(staff, `&type=${type}&batchId=${batchId}`)).items;
  const stocktakeCount = async () => (await staff.get("/api/stocktakes")).body.total as number;

  beforeEach(async () => {
    staff = await loginAs("staff");
    admin = await loginAs("admin");
    const p = await productByName(staff, "甘藍菜");
    A0103 = await locationIdByCode(staff, "A-01-03");
    A0104 = await locationIdByCode(staff, "A-01-04");
    batchId = (await staff.post("/api/stock/inbound", { productId: p.id, quantity: 30, expiryDate: "2026-12-31", allocations: [{ locationId: A0103, quantity: 20 }, { locationId: A0104, quantity: 10 }] }).expect(201)).body.batch.id;
  });

  it("系統 20、好的 17、爛 3：先報損 3 → 基準變 17 → 提交 17 相符 → 核准 0 筆調整，最後 17（不是 14）", async () => {
    const dmg = (await staff.post("/api/stock/damage", { batchId, locationId: A0103, quantity: 3, reason: "腐爛・盤點時發現" }).expect(201)).body;
    expect(await baselineQty(staff, A0103)).toBe(17);
    const st = (await staff.post("/api/stocktakes", { items: [{ locationId: A0103, batchId, systemQty: 17, countedQty: 17 }, { locationId: A0104, batchId, systemQty: 10, countedQty: 10 }], damageMovementIds: [dmg.movementId] }).expect(201)).body;
    expect(st.items.find((i: any) => i.locationId === A0103)).toMatchObject({ systemQty: 17, countedQty: 17, diff: 0 });
    expect(st.damages).toEqual([expect.objectContaining({ movementId: dmg.movementId, locationCode: "A-01-03", quantity: 3, reversalId: null })]);

    const a = await admin.post(`/api/stocktakes/${st.id}/approve`, {}).expect(200);
    expect(a.body.adjustments).toBe(0);
    expect(await locQty(staff, A0103)).toBe(17);
    expect((await batchMovements("DAMAGE")).map((m: any) => m.quantity)).toEqual([3]);
    expect(await batchMovements("ADJUSTMENT")).toHaveLength(0);
    // 核准後明細仍看得到盤點中的報損
    expect((await staff.get(`/api/stocktakes/${st.id}`)).body.damages[0]).toMatchObject({ movementId: dmg.movementId, quantity: 3 });
  });

  it("只報損一部分：系統 20、實盤 17、報損 2 → 剩差異 −1 另選原因 → 核准後 17；DAMAGE 2＋ADJUSTMENT 1，合計只扣 3", async () => {
    const dmg = (await staff.post("/api/stock/damage", { batchId, locationId: A0103, quantity: 2, reason: "腐爛" }).expect(201)).body;
    const st = (await staff.post("/api/stocktakes", { items: [{ locationId: A0103, batchId, systemQty: 18, countedQty: 17, reasonCode: "MISSING" }], damageMovementIds: [dmg.movementId] }).expect(201)).body;
    expect(st.items[0]).toMatchObject({ systemQty: 18, countedQty: 17, diff: -1 });
    expect((await admin.post(`/api/stocktakes/${st.id}/approve`, {}).expect(200)).body.adjustments).toBe(1);
    expect(await locQty(staff, A0103)).toBe(17);
    expect((await batchMovements("DAMAGE")).map((m: any) => m.quantity)).toEqual([2]);
    expect((await batchMovements("ADJUSTMENT")).map((m: any) => m.quantity)).toEqual([1]);
  });

  it("報損後畫面沒更新、仍用舊基準 20 提交 → 409 STOCKTAKE_BASELINE_CHANGED，不建單、不重複扣", async () => {
    const dmg = (await staff.post("/api/stock/damage", { batchId, locationId: A0103, quantity: 3, reason: "腐爛" }).expect(201)).body;
    const before = await stocktakeCount();
    const r = await staff.post("/api/stocktakes", { items: [{ locationId: A0103, batchId, systemQty: 20, countedQty: 17, reasonCode: "DAMAGED" }], damageMovementIds: [dmg.movementId] });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("STOCKTAKE_BASELINE_CHANGED");
    expect(await stocktakeCount()).toBe(before);
    expect(await locQty(staff, A0103)).toBe(17);
  });

  it("盤點已提交（差異 −3 腐爛）後才另外報損 3 → 核准 409 STOCKTAKE_CONFLICT，庫存維持 17 不會變 14", async () => {
    const st = (await staff.post("/api/stocktakes", { items: [{ locationId: A0103, batchId, systemQty: 20, countedQty: 17, reasonCode: "DAMAGED" }] }).expect(201)).body;
    await staff.post("/api/stock/damage", { batchId, locationId: A0103, quantity: 3, reason: "腐爛" }).expect(201);
    const a = await admin.post(`/api/stocktakes/${st.id}/approve`, {});
    expect(a.status).toBe(409);
    expect(a.body.error.code).toBe("STOCKTAKE_CONFLICT");
    expect(await locQty(staff, A0103)).toBe(17);
  });

  it("附帶的報損要合法：非報損 400；別人的報損、已復原、已附在別張盤點單 → 409；失敗都不建單", async () => {
    const items = [{ locationId: A0104, batchId, systemQty: 10, countedQty: 10 }];
    const inMove = (await batchMovements("IN"))[0];
    const before = await stocktakeCount();
    expect((await staff.post("/api/stocktakes", { items, damageMovementIds: [inMove.id] })).status).toBe(400);

    const adminDmg = (await admin.post("/api/stock/damage", { batchId, locationId: A0103, quantity: 1, reason: "壓損" }).expect(201)).body;
    expect((await staff.post("/api/stocktakes", { items, damageMovementIds: [adminDmg.movementId] })).status).toBe(409);

    const reversed = (await staff.post("/api/stock/damage", { batchId, locationId: A0103, quantity: 1, reason: "壓損" }).expect(201)).body;
    await admin.post(`/api/movements/${reversed.movementId}/reverse`, { reason: "登記錯誤" }).expect(201);
    expect((await staff.post("/api/stocktakes", { items, damageMovementIds: [reversed.movementId] })).status).toBe(409);
    expect(await stocktakeCount()).toBe(before);

    const dmg = (await staff.post("/api/stock/damage", { batchId, locationId: A0103, quantity: 1, reason: "腐爛" }).expect(201)).body;
    await staff.post("/api/stocktakes", { items, damageMovementIds: [dmg.movementId] }).expect(201);
    const again = await staff.post("/api/stocktakes", { items, damageMovementIds: [dmg.movementId] });
    expect(again.status).toBe(409);
    expect(again.body.error.message).toMatch(/已附在盤點 #\d+/);
    expect(await stocktakeCount()).toBe(before + 1);
  });

  it("平常直接報損不受影響：不經盤點也能報損", async () => {
    await staff.post("/api/stock/damage", { batchId, locationId: A0104, quantity: 2, reason: "凍傷" }).expect(201);
    expect(await locQty(staff, A0104)).toBe(8);
  });
});
