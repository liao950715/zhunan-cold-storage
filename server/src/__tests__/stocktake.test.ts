import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { prisma } from "../lib/prisma.js";
import { byCode, loginAs, productByName, resetDb } from "./helpers.js";

const app = createApp();
let staff: string;
let admin: string;
let batchId: number;
let A0101: number;
let A0102: number;

const locQty = async (locationId: number) => (await prisma.inventory.aggregate({ _sum: { quantity: true }, where: { locationId } }))._sum.quantity ?? 0;

describe("FR-015 盤點與核准、FR-017 Dashboard", () => {
  beforeEach(async () => {
    await resetDb();
    staff = await loginAs(app, "staff");
    admin = await loginAs(app, "admin");
    const p = await productByName("甘藍菜");
    A0101 = (await byCode("A-01-01")).id;
    A0102 = (await byCode("A-01-02")).id;
    const r = await request(app).post("/api/stock/inbound").set("Cookie", staff).send({ productId: p.id, quantity: 30, expiryDate: "2026-12-31", allocations: [{ locationId: A0101, quantity: 20 }, { locationId: A0102, quantity: 10 }] });
    batchId = r.body.batch.id;
  });

  const submit = () =>
    request(app).post("/api/stocktakes").set("Cookie", staff).send({ items: [{ locationId: A0101, batchId, countedQty: 18 }, { locationId: A0102, batchId, countedQty: 10 }] });

  it("AT-21：工作人員提交盤點 → 待核准單，系統基準記錄，不改庫存", async () => {
    const res = await submit();
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("PENDING");
    expect(res.body.items[0]).toMatchObject({ systemQty: 20, countedQty: 18, diff: -2 });
    expect(await locQty(A0101)).toBe(20);
  });

  it("AT-22：工作人員試圖核准／退回 → 403（後端擋）", async () => {
    const st = (await submit()).body;
    const a = await request(app).post(`/api/stocktakes/${st.id}/approve`).set("Cookie", staff).send({});
    expect(a.status).toBe(403);
    const r = await request(app).post(`/api/stocktakes/${st.id}/reject`).set("Cookie", staff).send({});
    expect(r.status).toBe(403);
    expect(await locQty(A0101)).toBe(20);
  });

  it("AT-23：管理員核准 → 庫存變為實盤、產生 ADJUSTMENT；退回 → 不變", async () => {
    const st = (await submit()).body;
    const a = await request(app).post(`/api/stocktakes/${st.id}/approve`).set("Cookie", admin).send({ note: "確認" });
    expect(a.status).toBe(200);
    expect(a.body.adjustments).toBe(1); // A-01-02 差異 0 不產生紀錄
    expect(await locQty(A0101)).toBe(18);
    const adj = await prisma.stockMovement.findFirstOrThrow({ where: { type: "ADJUSTMENT" } });
    expect(adj).toMatchObject({ quantity: 2, fromBeforeQty: 20, fromAfterQty: 18, referenceType: "STOCKTAKE", referenceId: st.id });
    // 已核准不可再操作
    expect((await request(app).post(`/api/stocktakes/${st.id}/approve`).set("Cookie", admin).send({})).status).toBe(409);

    const st2 = (await request(app).post("/api/stocktakes").set("Cookie", staff).send({ items: [{ locationId: A0101, batchId, countedQty: 5 }] })).body;
    const r = await request(app).post(`/api/stocktakes/${st2.id}/reject`).set("Cookie", admin).send({ note: "數字有誤" });
    expect(r.status).toBe(200);
    expect(await locQty(A0101)).toBe(18);
    expect((await request(app).get(`/api/stocktakes/${st2.id}`).set("Cookie", staff)).body.status).toBe("REJECTED");
  });

  it("AT-24：提交後庫存又改變 → 核准時 409 STOCKTAKE_CONFLICT，庫存不變", async () => {
    const st = (await submit()).body;
    await request(app).post("/api/stock/outbound").set("Cookie", staff).send({ productId: (await productByName("甘藍菜")).id, lines: [{ batchId, locationId: A0101, quantity: 1 }] }).expect(201);
    const a = await request(app).post(`/api/stocktakes/${st.id}/approve`).set("Cookie", admin).send({});
    expect(a.status).toBe(409);
    expect(a.body.error.code).toBe("STOCKTAKE_CONFLICT");
    expect(a.body.error.details.conflicts[0]).toMatchObject({ locationCode: "A-01-01", systemQty: 20, current: 19 });
    expect(await locQty(A0101)).toBe(19);
    expect((await request(app).get(`/api/stocktakes/${st.id}`).set("Cookie", staff)).body.status).toBe("PENDING");
  });

  it("盤點基準 API 回傳目前有貨的儲位×批次", async () => {
    const res = await request(app).get("/api/stocktakes/baseline").set("Cookie", staff);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0]).toMatchObject({ locationCode: "A-01-01", systemQty: 20 });
  });

  it("I-8／FR-017：Dashboard 依單位分組、效期與低庫存提醒", async () => {
    const strawberry = await productByName("草莓"); // 箱，提醒 7 天，警戒 10
    const A0103 = (await byCode("A-01-03")).id;
    const soon = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    await request(app).post("/api/stock/inbound").set("Cookie", staff).send({ productId: strawberry.id, quantity: 4, expiryDate: soon, allocations: [{ locationId: A0103, quantity: 4 }] }).expect(201);
    const res = await request(app).get("/api/dashboard").set("Cookie", staff);
    expect(res.status).toBe(200);
    expect(res.body.stats).toMatchObject({ productsInStock: 2, batchesInStock: 2, occupiedLocations: 3 });
    expect(res.body.totalsByUnit).toEqual(expect.arrayContaining([{ unit: "籠", quantity: 30 }, { unit: "箱", quantity: 4 }]));
    expect(res.body.expiryAlerts).toHaveLength(1);
    expect(res.body.expiryAlerts[0]).toMatchObject({ product: { name: "草莓" }, quantity: 4, expired: false });
    expect(res.body.lowStock.map((l: { name: string }) => l.name)).toContain("草莓");
    expect(res.body.lowStock.map((l: { name: string }) => l.name)).not.toContain("甘藍菜"); // 30 > 10
  });
});
