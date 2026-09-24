import { beforeEach, describe, expect, it } from "vitest";
import { Client, loginAs, locationIdByCode, locQty, movements, productByName, productTotal, snapshot } from "./helpers.js";

let staff: Client;
let admin: Client;
let cabbage: { id: number };
let carrot: { id: number };
let A0103: number, A0104: number, A0105: number;

async function inbound30() {
  return (await staff.post("/api/stock/inbound", { productId: cabbage.id, quantity: 30, expiryDate: "2026-12-31", allocations: [{ locationId: A0103, quantity: 20 }, { locationId: A0104, quantity: 10 }] }).expect(201)).body;
}
const lastOf = async (type: string) => (await movements(admin, `&type=${type}`)).items[0];

describe("FR-020 庫存異動復原（AT-33～AT-40）", () => {
  beforeEach(async () => {
    staff = await loginAs("staff");
    admin = await loginAs("admin");
    cabbage = await productByName(staff, "甘藍菜");
    carrot = await productByName(staff, "紅蘿蔔");
    [A0103, A0104, A0105] = await Promise.all(["A-01-03", "A-01-04", "A-01-05"].map((c) => locationIdByCode(staff, c)));
  });

  it("AT-33：管理員成功復原錯誤出庫，庫存加回原儲位；AT-35：原始紀錄保留＋新增反向紀錄", async () => {
    const { batch } = await inbound30();
    await staff.post("/api/stock/outbound", { productId: cabbage.id, lines: [{ batchId: batch.id, locationId: A0103, quantity: 8 }] }).expect(201);
    expect(await locQty(staff, A0103)).toBe(12);
    const out = await lastOf("OUT");
    const preview = await admin.get(`/api/movements/${out.id}/reversal-preview`);
    expect(preview.status).toBe(200);
    expect(preview.body.blocked).toBeNull();
    expect(preview.body.changes).toEqual([{ locationCode: "A-01-03", delta: 8, before: 12, after: 20 }]);

    const r = await admin.post(`/api/movements/${out.id}/reverse`, { reason: "出錯單" });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ originalId: out.id, originalType: "OUT", quantity: 8, to: { code: "A-01-03", before: 12, after: 20 } });
    expect(await locQty(staff, A0103)).toBe(20);
    expect(await productTotal(staff, cabbage.id)).toBe(30);

    const all = (await movements(admin)).items;
    const original = all.find((m) => m.id === out.id);
    expect(original).toMatchObject({ type: "OUT", quantity: 8, reversedById: r.body.reversalId }); // 原始紀錄仍在
    const rev = all.find((m) => m.id === r.body.reversalId);
    expect(rev).toMatchObject({ type: "REVERSAL", reversalOfId: out.id, reversalReason: "出錯單", batchId: batch.id, toLocationId: A0103, toBeforeQty: 12, toAfterQty: 20 });
    expect(rev.operator.displayName).toContain("李太太");
  });

  it("AT-34：工作人員不能復原（403），也不能看預覽", async () => {
    const { batch } = await inbound30();
    await staff.post("/api/stock/outbound", { productId: cabbage.id, lines: [{ batchId: batch.id, locationId: A0103, quantity: 1 }] }).expect(201);
    const out = await lastOf("OUT");
    expect((await staff.post(`/api/movements/${out.id}/reverse`, { reason: "x" })).status).toBe(403);
    expect((await staff.get(`/api/movements/${out.id}/reversal-preview`)).status).toBe(403);
    expect(await locQty(staff, A0103)).toBe(19);
    // 工作人員仍可查看復原紀錄
    expect((await staff.get("/api/movements?type=REVERSAL")).status).toBe(200);
  });

  it("AT-36：同一筆異動不得重複復原（409 ALREADY_REVERSED），復原紀錄本身不能再復原", async () => {
    const { batch } = await inbound30();
    await staff.post("/api/stock/outbound", { productId: cabbage.id, lines: [{ batchId: batch.id, locationId: A0103, quantity: 5 }] }).expect(201);
    const out = await lastOf("OUT");
    const first = await admin.post(`/api/movements/${out.id}/reverse`, { reason: "第一次" });
    expect(first.status).toBe(201);
    const again = await admin.post(`/api/movements/${out.id}/reverse`, { reason: "第二次" });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("ALREADY_REVERSED");
    expect(await locQty(staff, A0103)).toBe(20);
    const revAgain = await admin.post(`/api/movements/${first.body.reversalId}/reverse`, { reason: "復原復原" });
    expect(revAgain.status).toBe(409);
    // 並發同時送 5 次也只成功 1 次
    await staff.post("/api/stock/outbound", { productId: cabbage.id, lines: [{ batchId: batch.id, locationId: A0104, quantity: 2 }] }).expect(201);
    const out2 = await lastOf("OUT");
    const results = await Promise.all(Array.from({ length: 5 }, () => admin.post(`/api/movements/${out2.id}/reverse`, { reason: "併發" })));
    expect(results.filter((x) => x.status === 201)).toHaveLength(1);
    expect(await locQty(staff, A0104)).toBe(10);
  });

  it("AT-37：復原入庫時該批次庫存已不足（後續已出庫）→ 拒絕且庫存不變", async () => {
    const { batch } = await inbound30();
    const inMov = (await movements(admin, `&type=IN&locationId=${A0104}`)).items[0]; // A-01-04 +10
    await staff.post("/api/stock/outbound", { productId: cabbage.id, lines: [{ batchId: batch.id, locationId: A0104, quantity: 4 }] }).expect(201); // 剩 6
    const preview = await admin.get(`/api/movements/${inMov.id}/reversal-preview`);
    expect(preview.body.blocked).toContain("只剩 6");
    const before = await snapshot(admin);
    const r = await admin.post(`/api/movements/${inMov.id}/reverse`, { reason: "入錯" });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("INSUFFICIENT_STOCK");
    expect(await snapshot(admin)).toEqual(before);
  });

  it("AT-38：復原出庫後會超過儲位容量 → 拒絕", async () => {
    const { batch } = await inbound30(); // A-01-04 10（容量 20）
    await staff.post("/api/stock/outbound", { productId: cabbage.id, lines: [{ batchId: batch.id, locationId: A0104, quantity: 10 }] }).expect(201); // A-01-04 清空
    const out = await lastOf("OUT");
    // 之後又放進 15 籠新批次 → 只剩 5 的空間
    await staff.post("/api/stock/inbound", { productId: cabbage.id, quantity: 15, expiryDate: "2026-12-31", allocations: [{ locationId: A0104, quantity: 15 }] }).expect(201);
    const r = await admin.post(`/api/movements/${out.id}/reverse`, { reason: "出錯" });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("CAPACITY_EXCEEDED");
    expect(await locQty(staff, A0104)).toBe(15);
  });

  it("AT-38b：復原出庫但儲位已放了別的商品 → 拒絕（單一商品限制）", async () => {
    const { batch } = await inbound30();
    await staff.post("/api/stock/outbound", { productId: cabbage.id, lines: [{ batchId: batch.id, locationId: A0104, quantity: 10 }] }).expect(201);
    const out = await lastOf("OUT");
    await staff.post("/api/stock/inbound", { productId: carrot.id, quantity: 1, expiryDate: "2026-12-31", allocations: [{ locationId: A0104, quantity: 1 }] }).expect(201);
    const r = await admin.post(`/api/movements/${out.id}/reverse`, { reason: "出錯" });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("LOCATION_PRODUCT_CONFLICT");
  });

  it("AT-39：復原搬移後來源與目的數量正確，總量不變", async () => {
    const { batch } = await inbound30();
    await staff.post("/api/stock/transfer", { batchId: batch.id, fromLocationId: A0103, toLocationId: A0105, quantity: 5 }).expect(201);
    expect(await locQty(staff, A0103)).toBe(15);
    expect(await locQty(staff, A0105)).toBe(5);
    const tr = await lastOf("TRANSFER");
    const r = await admin.post(`/api/movements/${tr.id}/reverse`, { reason: "搬錯" });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ from: { code: "A-01-05", before: 5, after: 0 }, to: { code: "A-01-03", before: 15, after: 20 } });
    expect(await locQty(staff, A0103)).toBe(20);
    expect(await locQty(staff, A0105)).toBe(0);
    expect(await productTotal(staff, cabbage.id)).toBe(30);
  });

  it("復原報損與盤點調整：加回／反方向", async () => {
    const { batch } = await inbound30();
    await staff.post("/api/stock/damage", { batchId: batch.id, locationId: A0103, quantity: 3, reason: "凍傷" }).expect(201);
    const dmg = await lastOf("DAMAGE");
    expect((await admin.post(`/api/movements/${dmg.id}/reverse`, { reason: "誤報" })).status).toBe(201);
    expect(await locQty(staff, A0103)).toBe(20);
    const st = (await staff.post("/api/stocktakes", { items: [{ locationId: A0103, batchId: batch.id, countedQty: 18 }] }).expect(201)).body;
    await admin.post(`/api/stocktakes/${st.id}/approve`, {}).expect(200);
    expect(await locQty(staff, A0103)).toBe(18);
    const adj = await lastOf("ADJUSTMENT");
    expect((await admin.post(`/api/movements/${adj.id}/reverse`, { reason: "盤錯" })).status).toBe(201);
    expect(await locQty(staff, A0103)).toBe(20);
  });

  it("AT-40：復原搬移時目的端扣回成功但來源端加回失敗（容量）→ 全部回滾", async () => {
    const { batch } = await inbound30(); // A-01-03 20／A-01-04 10
    await staff.post("/api/stock/transfer", { batchId: batch.id, fromLocationId: A0103, toLocationId: A0105, quantity: 5 }).expect(201); // A-01-03 15
    const tr = await lastOf("TRANSFER");
    await staff.post("/api/stock/inbound", { productId: cabbage.id, quantity: 5, expiryDate: "2026-12-31", allocations: [{ locationId: A0103, quantity: 5 }] }).expect(201); // A-01-03 又滿 20
    const before = await snapshot(admin);
    const r = await admin.post(`/api/movements/${tr.id}/reverse`, { reason: "搬錯" });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("CAPACITY_EXCEEDED");
    expect(await snapshot(admin)).toEqual(before); // A-01-05 沒有被扣、沒有 REVERSAL 紀錄
    expect((await movements(admin, "&type=REVERSAL")).total).toBe(0);
  });

  it("復原原因必填", async () => {
    const { batch } = await inbound30();
    await staff.post("/api/stock/outbound", { productId: cabbage.id, lines: [{ batchId: batch.id, locationId: A0103, quantity: 1 }] }).expect(201);
    const out = await lastOf("OUT");
    expect((await admin.post(`/api/movements/${out.id}/reverse`, { reason: "" })).status).toBe(400);
  });
});
