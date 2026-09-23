import { beforeEach, describe, expect, it } from "vitest";
import { Client, loginAs, locationIdByCode, locQty, movements, productByName, productTotal, snapshot } from "./helpers.js";

let c: Client;
let cabbage: { id: number };
let carrot: { id: number };
let A0101: number, A0102: number, A0103: number, A0104: number, A0105: number, A0201: number;
const BATCH_NO = /^B\d{8}-\d{3,}$/;

async function inbound30() {
  const r = await c.post("/api/stock/inbound", { productId: cabbage.id, quantity: 30, expiryDate: "2026-12-31", allocations: [{ locationId: A0103, quantity: 20 }, { locationId: A0104, quantity: 10 }] });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body;
}

describe("Stage 2 庫存交易（Durable Object SQLite）", () => {
  beforeEach(async () => {
    c = await loginAs("staff");
    cabbage = await productByName(c, "甘藍菜");
    carrot = await productByName(c, "紅蘿蔔");
    [A0101, A0102, A0103, A0104, A0105, A0201] = await Promise.all(["A-01-01", "A-01-02", "A-01-03", "A-01-04", "A-01-05", "A-02-01"].map((code) => locationIdByCode(c, code)));
  });

  describe("入庫", () => {
    it("AT-03：30 籠分兩儲位，各儲位正確、合計 30，並留下兩筆 IN 紀錄", async () => {
      const body = await inbound30();
      expect(body.batch.batchNo).toMatch(BATCH_NO);
      expect(await locQty(c, A0103)).toBe(20);
      expect(await locQty(c, A0104)).toBe(10);
      expect(await productTotal(c, cabbage.id)).toBe(30);
      const movs = (await movements(c, `&type=IN&productId=${cabbage.id}`)).items;
      expect(movs).toHaveLength(2);
      expect(movs.find((m) => m.toLocationId === A0103)).toMatchObject({ toBeforeQty: 0, toAfterQty: 20, productNameSnapshot: "甘藍菜" });
    });

    it("AT-02：同日連續入庫批次編號唯一且遞增", async () => {
      const nos = [];
      for (let i = 0; i < 3; i++) nos.push((await c.post("/api/stock/inbound", { productId: cabbage.id, quantity: 1, receivedDate: "2026-09-23", expiryDate: "2026-12-31", allocations: [{ locationId: A0103, quantity: 1 }] })).body.batch.batchNo);
      expect(nos).toEqual(["B20260923-001", "B20260923-002", "B20260923-003"]);
    });

    it("AT-04：分配合計≠總量 → 409 ALLOCATION_MISMATCH，無任何寫入", async () => {
      const before = await snapshot(c);
      const r = await c.post("/api/stock/inbound", { productId: cabbage.id, quantity: 30, expiryDate: "2026-12-31", allocations: [{ locationId: A0103, quantity: 20 }, { locationId: A0104, quantity: 5 }] });
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe("ALLOCATION_MISMATCH");
      expect(await snapshot(c)).toEqual(before);
    });

    it("AT-05：第二儲位超容量 → 409，第一儲位也不得部分寫入；訊息說明還能放多少", async () => {
      const before = await snapshot(c);
      const r = await c.post("/api/stock/inbound", { productId: cabbage.id, quantity: 35, expiryDate: "2026-12-31", allocations: [{ locationId: A0103, quantity: 10 }, { locationId: A0104, quantity: 25 }] });
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe("CAPACITY_EXCEEDED");
      expect(r.body.error.message).toContain("A-01-04");
      expect(r.body.error.message).toContain("最多還能放 20");
      expect(await snapshot(c)).toEqual(before);
    });

    it("AT-06：不同商品放入已有貨儲位 → 409 LOCATION_PRODUCT_CONFLICT", async () => {
      const r = await c.post("/api/stock/inbound", { productId: cabbage.id, quantity: 1, expiryDate: "2026-12-31", allocations: [{ locationId: A0101, quantity: 1 }] }); // A-01-01 有紅蘿蔔
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe("LOCATION_PRODUCT_CONFLICT");
      expect(r.body.error.message).toContain("紅蘿蔔");
      expect(await locQty(c, A0101)).toBe(12);
    });

    it("AT-07：同商品不同批次共用儲位，且批次可區分（先到期在前）", async () => {
      await inbound30();
      await c.post("/api/stock/inbound", { productId: cabbage.id, quantity: 5, expiryDate: "2026-11-30", allocations: [{ locationId: A0104, quantity: 5 }] }).expect(201);
      const d = await c.get(`/api/locations/${A0104}`);
      expect(d.body.lines).toHaveLength(2);
      expect(d.body.occupied).toBe(15);
      expect(d.body.lines[0].batch.expiryDate).toBe("2026-11-30");
    });
  });

  describe("出庫與 FEFO", () => {
    it("AT-11：FEFO 建議依到期日排序，人工改選其他批次仍可出庫", async () => {
      await inbound30();
      const early = await c.post("/api/stock/inbound", { productId: cabbage.id, quantity: 5, expiryDate: "2026-10-15", allocations: [{ locationId: A0105, quantity: 5 }] });
      const sug = await c.post("/api/stock/outbound/suggest", { productId: cabbage.id, quantity: 8 });
      expect(sug.status).toBe(200);
      expect(sug.body.shortage).toBe(0);
      expect(sug.body.suggestions[0]).toMatchObject({ batchNo: early.body.batch.batchNo, take: 5, expired: false });
      expect(sug.body.suggestions[1]).toMatchObject({ locationCode: "A-01-03", take: 3 });
      const later = sug.body.suggestions[1].batchId;
      await c.post("/api/stock/outbound", { productId: cabbage.id, lines: [{ batchId: later, locationId: A0104, quantity: 8 }] }).expect(201);
      expect(await locQty(c, A0104)).toBe(2);
      expect(await locQty(c, A0105)).toBe(5);
    });

    it("FEFO：已過期批次仍列出並標記 expired（Q6）", async () => {
      await c.post("/api/stock/inbound", { productId: cabbage.id, quantity: 2, expiryDate: "2020-01-01", allocations: [{ locationId: A0103, quantity: 2 }] }).expect(201);
      const sug = await c.post("/api/stock/outbound/suggest", { productId: cabbage.id, quantity: 1 });
      expect(sug.body.suggestions[0].expired).toBe(true);
    });

    it("AT-12：超額出庫 → 409 INSUFFICIENT_STOCK；多筆明細其中一筆超額則全部回滾", async () => {
      const { batch } = await inbound30();
      const before = await snapshot(c);
      const r = await c.post("/api/stock/outbound", { productId: cabbage.id, lines: [{ batchId: batch.id, locationId: A0103, quantity: 5 }, { batchId: batch.id, locationId: A0104, quantity: 11 }] });
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe("INSUFFICIENT_STOCK");
      expect(await snapshot(c)).toEqual(before);
    });

    it("出庫扣到 0 時儲位清空，可改存另一商品", async () => {
      const { batch } = await inbound30();
      await c.post("/api/stock/outbound", { productId: cabbage.id, lines: [{ batchId: batch.id, locationId: A0104, quantity: 10 }] }).expect(201);
      await c.post("/api/stock/inbound", { productId: carrot.id, quantity: 3, expiryDate: "2026-12-31", allocations: [{ locationId: A0104, quantity: 3 }] }).expect(201);
    });
  });

  describe("搬移", () => {
    it("AT-13：部分搬移 5 籠，來源減、目的增、總量不變，紀錄含前後數量", async () => {
      const { batch } = await inbound30();
      await c.post("/api/stock/transfer", { batchId: batch.id, fromLocationId: A0103, toLocationId: A0105, quantity: 5 }).expect(201);
      expect(await locQty(c, A0103)).toBe(15);
      expect(await locQty(c, A0105)).toBe(5);
      expect(await productTotal(c, cabbage.id)).toBe(30);
      const m = (await movements(c, "&type=TRANSFER")).items[0];
      expect(m).toMatchObject({ fromBeforeQty: 20, fromAfterQty: 15, toBeforeQty: 0, toAfterQty: 5, locationCodeSnapshot: "A-01-03→A-01-05" });
    });

    it("AT-14：搬移超容量或混放商品 → 409，來源不變", async () => {
      const { batch } = await inbound30();
      const mix = await c.post("/api/stock/transfer", { batchId: batch.id, fromLocationId: A0103, toLocationId: A0201, quantity: 1 }); // 馬鈴薯
      expect(mix.status).toBe(409);
      expect(mix.body.error.code).toBe("LOCATION_PRODUCT_CONFLICT");
      const over = await c.post("/api/stock/transfer", { batchId: batch.id, fromLocationId: A0103, toLocationId: A0104, quantity: 15 }); // A-01-04 已 10，容量 20
      expect(over.status).toBe(409);
      expect(over.body.error.code).toBe("CAPACITY_EXCEEDED");
      expect(await locQty(c, A0103)).toBe(20);
    });

    it("搬移超過來源可用量 → 409", async () => {
      const { batch } = await inbound30();
      const r = await c.post("/api/stock/transfer", { batchId: batch.id, fromLocationId: A0104, toLocationId: A0105, quantity: 11 });
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe("INSUFFICIENT_STOCK");
    });
  });

  describe("報損", () => {
    it("AT-19：報損 3 籠，庫存減 3 且留 DAMAGE 紀錄含原因與操作者", async () => {
      const { batch } = await inbound30();
      await c.post("/api/stock/damage", { batchId: batch.id, locationId: A0103, quantity: 3, reason: "凍傷" }).expect(201);
      expect(await locQty(c, A0103)).toBe(17);
      const m = (await movements(c, "&type=DAMAGE")).items[0];
      expect(m.reason).toBe("凍傷");
      expect(m.operator.displayName).toBe("倉庫工作人員");
    });

    it("AT-20：超額報損 → 409；原因必填 400", async () => {
      const { batch } = await inbound30();
      expect((await c.post("/api/stock/damage", { batchId: batch.id, locationId: A0104, quantity: 11, reason: "x" })).status).toBe(409);
      expect((await c.post("/api/stock/damage", { batchId: batch.id, locationId: A0104, quantity: 1, reason: "" })).status).toBe(400);
    });
  });

  describe("容量設定（FR-007）", () => {
    it("依儲位＋商品設定容量；低於目前占用 → 409 CAPACITY_BELOW_OCCUPIED", async () => {
      await inbound30();
      const ok = await c.put(`/api/locations/${A0103}/capacities`, { items: [{ productId: cabbage.id, capacity: 25 }] });
      expect(ok.status).toBe(200);
      expect(ok.body.items[0]).toMatchObject({ productId: cabbage.id, capacity: 25 });
      const bad = await c.put(`/api/locations/${A0103}/capacities`, { items: [{ productId: cabbage.id, capacity: 19 }] });
      expect(bad.status).toBe(409);
      expect(bad.body.error.code).toBe("CAPACITY_BELOW_OCCUPIED");
      await c.post("/api/stock/inbound", { productId: cabbage.id, quantity: 5, expiryDate: "2026-12-31", allocations: [{ locationId: A0103, quantity: 5 }] }).expect(201);
    });

    it("defaultCapacity 設為 null 代表不限制（Q2）", async () => {
      await c.put(`/api/locations/${A0105}/capacities`, { defaultCapacity: null }).expect(200);
      await c.post("/api/stock/inbound", { productId: cabbage.id, quantity: 999, expiryDate: "2026-12-31", allocations: [{ locationId: A0105, quantity: 999 }] }).expect(201);
    });
  });

  describe("資料完整性", () => {
    it("I-3：同 Idempotency-Key 送兩次出庫，只扣一次並回傳相同結果", async () => {
      const { batch } = await inbound30();
      const key = crypto.randomUUID();
      const body = { productId: cabbage.id, lines: [{ batchId: batch.id, locationId: A0103, quantity: 4 }] };
      const a = await c.post("/api/stock/outbound", body, { "Idempotency-Key": key });
      const b = await c.post("/api/stock/outbound", body, { "Idempotency-Key": key });
      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      expect(b.body).toEqual(a.body);
      expect(await locQty(c, A0103)).toBe(16);
      expect((await movements(c, "&type=OUT")).total).toBe(1);
    });

    it("I-4：並發 20 筆各扣 1（可用 10）→ 恰好 10 成功、10 個 409、最終 0", async () => {
      const { batch } = await inbound30();
      const results = await Promise.all(Array.from({ length: 20 }, () => c.post("/api/stock/outbound", { productId: cabbage.id, lines: [{ batchId: batch.id, locationId: A0104, quantity: 1 }] })));
      expect(results.filter((r) => r.status === 201).length).toBe(10);
      expect(results.filter((r) => r.status === 409 && r.body.error.code === "INSUFFICIENT_STOCK").length).toBe(10);
      expect(await locQty(c, A0104)).toBe(0);
      expect((await movements(c, "&type=OUT")).total).toBe(10);
    });

    it("並發入庫批次編號仍唯一", async () => {
      const results = await Promise.all(Array.from({ length: 8 }, (_, i) => c.post("/api/stock/inbound", { productId: cabbage.id, quantity: 1, receivedDate: "2026-09-23", expiryDate: "2026-12-31", allocations: [{ locationId: [A0103, A0104, A0105][i % 3], quantity: 1 }] })));
      expect(results.every((r) => r.status === 201)).toBe(true);
      expect(new Set(results.map((r) => r.body.batch.batchNo)).size).toBe(8);
    });
  });

  it("AT-25 整合情境：入庫 30 → 搬移 5 → 出庫 10（FEFO）→ 報損 3 ＝ 17，四類可查且數量可追溯", async () => {
    const { batch } = await inbound30();
    await c.post("/api/stock/transfer", { batchId: batch.id, fromLocationId: A0103, toLocationId: A0105, quantity: 5 }).expect(201);
    expect(await productTotal(c, cabbage.id)).toBe(30);
    const sug = await c.post("/api/stock/outbound/suggest", { productId: cabbage.id, quantity: 10 });
    const lines = sug.body.suggestions.filter((s: any) => s.take > 0).map((s: any) => ({ batchId: s.batchId, locationId: s.locationId, quantity: s.take }));
    await c.post("/api/stock/outbound", { productId: cabbage.id, lines }).expect(201);
    expect(await productTotal(c, cabbage.id)).toBe(20);
    await c.post("/api/stock/damage", { batchId: batch.id, locationId: A0104, quantity: 3, reason: "壓損" }).expect(201);
    expect(await productTotal(c, cabbage.id)).toBe(17);
    const stock = await c.get(`/api/products/${cabbage.id}/stock`);
    expect(stock.body.lines.reduce((s: number, l: any) => s + l.quantity, 0)).toBe(17);
    for (const type of ["IN", "TRANSFER", "OUT", "DAMAGE"]) {
      const r = await movements(c, `&type=${type}&productId=${cabbage.id}`);
      expect(r.total).toBeGreaterThan(0);
      for (const m of r.items) expect(m.type).toBe(type);
    }
    const net = (await movements(c, `&productId=${cabbage.id}`)).items.reduce((s, m) => (m.type === "IN" ? s + m.quantity : m.type === "OUT" || m.type === "DAMAGE" ? s - m.quantity : s), 0);
    expect(net).toBe(17);
  });
});
