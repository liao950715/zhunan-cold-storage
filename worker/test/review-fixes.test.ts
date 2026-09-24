/** 2026-09-24 審查修正：I-10～I-14（盤點容量／混放、盤點基準、布局容量、防重送內容綁定、儲位出庫過期） */
import { beforeEach, describe, expect, it } from "vitest";
import { Client, loginAs, locationIdByCode, locQty, productByName } from "./helpers.js";

let staff: Client;
let admin: Client;
let A0103: number, A0104: number, A0105: number;
let cabbageId: number;

describe("審查修正（後端不變量）", () => {
  beforeEach(async () => {
    staff = await loginAs("staff");
    admin = await loginAs("admin");
    A0103 = await locationIdByCode(staff, "A-01-03");
    A0104 = await locationIdByCode(staff, "A-01-04");
    A0105 = await locationIdByCode(staff, "A-01-05");
    cabbageId = (await productByName(staff, "甘藍菜")).id;
  });

  it("I-10：盤點核准不可超過容量（容量 20、目前 20、實盤 25 → 409，庫存不變）", async () => {
    const batchId = (await staff.post("/api/stock/inbound", { productId: cabbageId, quantity: 20, expiryDate: "2026-12-31", allocations: [{ locationId: A0103, quantity: 20 }] }).expect(201)).body.batch.id;
    const st = (await staff.post("/api/stocktakes", { items: [{ locationId: A0103, batchId, countedQty: 25 }] }).expect(201)).body;
    const r = await admin.post(`/api/stocktakes/${st.id}/approve`, {});
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("CAPACITY_EXCEEDED");
    expect(await locQty(staff, A0103)).toBe(20);
    expect((await staff.get(`/api/stocktakes/${st.id}`)).body.status).toBe("PENDING");
  });

  it("I-11：盤點不可把不同商品盤進已有貨的儲位（提交即擋、核准也擋）", async () => {
    const carrot = (await productByName(staff, "紅蘿蔔")).id;
    const cabbageBatch = (await staff.post("/api/stock/inbound", { productId: cabbageId, quantity: 5, expiryDate: "2026-12-31", allocations: [{ locationId: A0103, quantity: 5 }] }).expect(201)).body.batch.id;
    const carrotBatch = (await staff.post("/api/stock/inbound", { productId: carrot, quantity: 5, expiryDate: "2026-12-31", allocations: [{ locationId: A0104, quantity: 5 }] }).expect(201)).body.batch.id;
    // 提交：A-01-03 放甘藍菜，卻盤入紅蘿蔔批次 3 個
    const r = await staff.post("/api/stocktakes", { items: [{ locationId: A0103, batchId: carrotBatch, countedQty: 3 }] });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("LOCATION_PRODUCT_CONFLICT");
    // 核准：提交時 A-01-05 是空的（合法），核准前先放入甘藍菜 → 核准時擋混放
    const st = (await staff.post("/api/stocktakes", { items: [{ locationId: A0105, batchId: carrotBatch, countedQty: 2 }] }).expect(201)).body;
    await staff.post("/api/stock/transfer", { batchId: cabbageBatch, fromLocationId: A0103, toLocationId: A0105, quantity: 2 }).expect(201);
    const a = await admin.post(`/api/stocktakes/${st.id}/approve`, {});
    expect(a.status).toBe(409);
    expect(a.body.error.code).toBe("LOCATION_PRODUCT_CONFLICT");
    expect(await locQty(staff, A0105)).toBe(2);
  });

  it("I-12：清點期間庫存變動 → 提交時以畫面基準比對，409 不接受", async () => {
    const batchId = (await staff.post("/api/stock/inbound", { productId: cabbageId, quantity: 20, expiryDate: "2026-12-31", allocations: [{ locationId: A0103, quantity: 20 }] }).expect(201)).body.batch.id;
    // 畫面基準 20；別人出庫 5
    await staff.post("/api/stock/outbound", { productId: cabbageId, lines: [{ batchId, locationId: A0103, quantity: 5 }] }).expect(201);
    const r = await staff.post("/api/stocktakes", { items: [{ locationId: A0103, batchId, countedQty: 20, systemQty: 20 }] });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("STOCKTAKE_BASELINE_CHANGED");
    // 重新整理後基準 15 → 可提交
    await staff.post("/api/stocktakes", { items: [{ locationId: A0103, batchId, countedQty: 15, systemQty: 15 }] }).expect(201);
  });

  it("I-13：布局編輯把容量改到低於現有庫存 → 409，整筆布局不變", async () => {
    await staff.post("/api/stock/inbound", { productId: cabbageId, quantity: 15, expiryDate: "2026-12-31", allocations: [{ locationId: A0103, quantity: 15 }] }).expect(201);
    const whA = (await staff.get("/api/warehouses")).body.items.find((w: any) => w.code === "A").id;
    const l = (await staff.get(`/api/warehouses/${whA}/layout`)).body;
    const input = { version: l.layoutVersion, racks: l.racks.map((r: any) => ({ id: r.id, code: r.code, x: r.x, y: r.y, width: r.width, height: r.height, locations: r.locations.map((x: any) => ({ id: x.id, code: x.code, x: x.x, y: x.y, width: x.width, height: x.height, defaultCapacity: x.code === "A-01-03" ? 10 : x.defaultCapacity })) })) };
    input.racks[0].x = 300; // 同一筆也改了位置，應一起回滾
    const r = await staff.put(`/api/warehouses/${whA}/layout`, input);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("CAPACITY_BELOW_OCCUPIED");
    const after = (await staff.get(`/api/warehouses/${whA}/layout`)).body;
    expect(after.layoutVersion).toBe(l.layoutVersion);
    expect(after.racks[0].x).toBe(l.racks[0].x);
    expect(after.racks.flatMap((x: any) => x.locations).find((x: any) => x.code === "A-01-03").defaultCapacity).toBe(20);
  });

  it("I-14：同 Idempotency-Key 但內容不同 → 409 IDEMPOTENCY_MISMATCH，不再扣庫存；內容相同才回放", async () => {
    const batchId = (await staff.post("/api/stock/inbound", { productId: cabbageId, quantity: 20, expiryDate: "2026-12-31", allocations: [{ locationId: A0103, quantity: 20 }] }).expect(201)).body.batch.id;
    const key = "review-key-1";
    const body10 = { productId: cabbageId, lines: [{ batchId, locationId: A0103, quantity: 10 }] };
    const a = await staff.post("/api/stock/outbound", body10, { "Idempotency-Key": key });
    expect(a.status).toBe(201);
    const b = await staff.post("/api/stock/outbound", { ...body10, lines: [{ batchId, locationId: A0103, quantity: 5 }] }, { "Idempotency-Key": key });
    expect(b.status).toBe(409);
    expect(b.body.error.code).toBe("IDEMPOTENCY_MISMATCH");
    const c = await staff.post("/api/stock/outbound", body10, { "Idempotency-Key": key });
    expect(c.status).toBe(201);
    expect(c.body).toEqual(a.body);
    expect(await locQty(staff, A0103)).toBe(10);
  });
});
