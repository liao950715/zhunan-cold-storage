import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { createApp } from "../app.js";
import { prisma } from "../lib/prisma.js";
import { BATCH_NO_PATTERN } from "../lib/batchNumber.js";
import { byCode, loginAs, productByName, resetDb } from "./helpers.js";

const app = createApp();
let staff: string;
let cabbage: { id: number };
let carrot: { id: number };
let A0101: number, A0102: number, A0103: number, A0201: number;

const post = (path: string, body: unknown, key?: string) => {
  const r = request(app).post(path).set("Cookie", staff);
  return (key ? r.set("Idempotency-Key", key) : r).send(body);
};

const productTotal = async (productId: number) => (await prisma.inventory.aggregate({ _sum: { quantity: true }, where: { batch: { productId } } }))._sum.quantity ?? 0;
const locQty = async (locationId: number) => (await prisma.inventory.aggregate({ _sum: { quantity: true }, where: { locationId } }))._sum.quantity ?? 0;
const snapshot = async () => ({
  inv: await prisma.inventory.findMany({ orderBy: { id: "asc" } }),
  mov: await prisma.stockMovement.count(),
  batch: await prisma.batch.count(),
});

async function inbound30() {
  const res = await post("/api/stock/inbound", { productId: cabbage.id, quantity: 30, expiryDate: "2026-12-31", allocations: [{ locationId: A0101, quantity: 20 }, { locationId: A0102, quantity: 10 }] });
  expect(res.status).toBe(201);
  return res.body;
}

describe("Stage 2 庫存交易", () => {
  beforeAll(async () => {
    staff = "";
  });

  beforeEach(async () => {
    await resetDb();
    staff = await loginAs(app, "staff");
    cabbage = await productByName("甘藍菜");
    carrot = await productByName("紅蘿蔔");
    [A0101, A0102, A0103, A0201] = await Promise.all(["A-01-01", "A-01-02", "A-01-03", "A-02-01"].map(async (c) => (await byCode(c)).id));
  });

  describe("入庫", () => {
    it("AT-03：30 籠分兩儲位，各儲位正確、合計 30，並留下兩筆 IN 紀錄", async () => {
      const body = await inbound30();
      expect(body.batch.batchNo).toMatch(BATCH_NO_PATTERN);
      expect(await locQty(A0101)).toBe(20);
      expect(await locQty(A0102)).toBe(10);
      expect(await productTotal(cabbage.id)).toBe(30);
      const movs = await prisma.stockMovement.findMany({ where: { type: "IN" } });
      expect(movs).toHaveLength(2);
      expect(movs[0]).toMatchObject({ toBeforeQty: 0, toAfterQty: 20, productNameSnapshot: "甘藍菜" });
    });

    it("AT-02：同日連續入庫批次編號唯一且遞增", async () => {
      const nos = [];
      for (let i = 0; i < 3; i++) {
        const r = await post("/api/stock/inbound", { productId: cabbage.id, quantity: 1, receivedDate: "2026-09-23", expiryDate: "2026-12-31", allocations: [{ locationId: A0101, quantity: 1 }] });
        nos.push(r.body.batch.batchNo);
      }
      expect(nos).toEqual(["B20260923-001", "B20260923-002", "B20260923-003"]);
    });

    it("AT-04：分配合計≠總量 → 409 ALLOCATION_MISMATCH，無任何寫入", async () => {
      const res = await post("/api/stock/inbound", { productId: cabbage.id, quantity: 30, expiryDate: "2026-12-31", allocations: [{ locationId: A0101, quantity: 20 }, { locationId: A0102, quantity: 5 }] });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("ALLOCATION_MISMATCH");
      expect(await prisma.batch.count()).toBe(0);
    });

    it("AT-05：第二儲位超容量 → 409，第一儲位也不得部分寫入", async () => {
      const before = await snapshot();
      const res = await post("/api/stock/inbound", { productId: cabbage.id, quantity: 35, expiryDate: "2026-12-31", allocations: [{ locationId: A0101, quantity: 10 }, { locationId: A0102, quantity: 25 }] });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("CAPACITY_EXCEEDED");
      expect(res.body.error.message).toContain("A-01-02");
      expect(await snapshot()).toEqual(before);
    });

    it("AT-06：不同商品放入已有貨儲位 → 409 LOCATION_PRODUCT_CONFLICT", async () => {
      await inbound30();
      const res = await post("/api/stock/inbound", { productId: carrot.id, quantity: 1, expiryDate: "2026-12-31", allocations: [{ locationId: A0101, quantity: 1 }] });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("LOCATION_PRODUCT_CONFLICT");
      expect(res.body.error.message).toContain("甘藍菜");
      expect(await locQty(A0101)).toBe(20);
    });

    it("AT-07：同商品不同批次共用儲位，且批次可區分", async () => {
      await inbound30();
      const res = await post("/api/stock/inbound", { productId: cabbage.id, quantity: 5, expiryDate: "2026-11-30", allocations: [{ locationId: A0102, quantity: 5 }] });
      expect(res.status).toBe(201);
      const detail = await request(app).get(`/api/locations/${A0102}`).set("Cookie", staff);
      expect(detail.body.lines).toHaveLength(2);
      expect(detail.body.occupied).toBe(15);
      expect(detail.body.lines[0].batch.expiryDate).toBe("2026-11-30"); // 先到期在前
    });

    it("停用商品不可入庫", async () => {
      await request(app).patch(`/api/products/${carrot.id}`).set("Cookie", staff).send({ status: "INACTIVE" });
      const res = await post("/api/stock/inbound", { productId: carrot.id, quantity: 1, expiryDate: "2026-12-31", allocations: [{ locationId: A0103, quantity: 1 }] });
      expect(res.status).toBe(409);
    });
  });

  describe("出庫與 FEFO", () => {
    it("AT-11：FEFO 建議依到期日排序，人工改選其他批次仍可出庫", async () => {
      await inbound30(); // 到期 12-31
      const early = await post("/api/stock/inbound", { productId: cabbage.id, quantity: 5, expiryDate: "2026-10-15", allocations: [{ locationId: A0103, quantity: 5 }] });
      const sug = await post("/api/stock/outbound/suggest", { productId: cabbage.id, quantity: 8 });
      expect(sug.status).toBe(200);
      expect(sug.body.shortage).toBe(0);
      expect(sug.body.suggestions[0]).toMatchObject({ batchNo: early.body.batch.batchNo, take: 5, expired: false });
      expect(sug.body.suggestions[1]).toMatchObject({ locationCode: "A-01-01", take: 3 });

      // 人工改選：只從 A-01-02 的晚到期批次出 8
      const laterBatchId = sug.body.suggestions[1].batchId;
      const out = await post("/api/stock/outbound", { productId: cabbage.id, lines: [{ batchId: laterBatchId, locationId: A0102, quantity: 8 }] });
      expect(out.status).toBe(201);
      expect(await locQty(A0102)).toBe(2);
      expect(await locQty(A0103)).toBe(5);
    });

    it("FEFO：已過期批次仍列出並標記 expired（Q6）", async () => {
      await post("/api/stock/inbound", { productId: cabbage.id, quantity: 2, expiryDate: "2020-01-01", allocations: [{ locationId: A0101, quantity: 2 }] });
      const sug = await post("/api/stock/outbound/suggest", { productId: cabbage.id, quantity: 1 });
      expect(sug.body.suggestions[0].expired).toBe(true);
    });

    it("AT-12：超額出庫 → 409 INSUFFICIENT_STOCK，多筆明細其中一筆超額則全部回滾", async () => {
      const { batch } = await inbound30();
      const before = await snapshot();
      const res = await post("/api/stock/outbound", { productId: cabbage.id, lines: [{ batchId: batch.id, locationId: A0101, quantity: 5 }, { batchId: batch.id, locationId: A0102, quantity: 11 }] });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("INSUFFICIENT_STOCK");
      expect(await snapshot()).toEqual(before);
    });

    it("出庫扣到 0 時儲位清空，可改存另一商品", async () => {
      const { batch } = await inbound30();
      await post("/api/stock/outbound", { productId: cabbage.id, lines: [{ batchId: batch.id, locationId: A0102, quantity: 10 }] }).expect(201);
      const res = await post("/api/stock/inbound", { productId: carrot.id, quantity: 3, expiryDate: "2026-12-31", allocations: [{ locationId: A0102, quantity: 3 }] });
      expect(res.status).toBe(201);
    });
  });

  describe("搬移", () => {
    it("AT-13：部分搬移 5 籠，來源減、目的增、總量不變，紀錄含前後數量", async () => {
      const { batch } = await inbound30();
      const res = await post("/api/stock/transfer", { batchId: batch.id, fromLocationId: A0101, toLocationId: A0103, quantity: 5 });
      expect(res.status).toBe(201);
      expect(await locQty(A0101)).toBe(15);
      expect(await locQty(A0103)).toBe(5);
      expect(await productTotal(cabbage.id)).toBe(30);
      const m = await prisma.stockMovement.findFirstOrThrow({ where: { type: "TRANSFER" } });
      expect(m).toMatchObject({ fromBeforeQty: 20, fromAfterQty: 15, toBeforeQty: 0, toAfterQty: 5, locationCodeSnapshot: "A-01-01→A-01-03" });
    });

    it("AT-14：搬移超容量或混放商品 → 409，來源不變", async () => {
      const { batch } = await inbound30();
      await post("/api/stock/inbound", { productId: carrot.id, quantity: 1, expiryDate: "2026-12-31", allocations: [{ locationId: A0201, quantity: 1 }] });
      const mix = await post("/api/stock/transfer", { batchId: batch.id, fromLocationId: A0101, toLocationId: A0201, quantity: 1 });
      expect(mix.status).toBe(409);
      expect(mix.body.error.code).toBe("LOCATION_PRODUCT_CONFLICT");
      const over = await post("/api/stock/transfer", { batchId: batch.id, fromLocationId: A0101, toLocationId: A0102, quantity: 15 }); // A-01-02 已 10，容量 20
      expect(over.status).toBe(409);
      expect(over.body.error.code).toBe("CAPACITY_EXCEEDED");
      expect(await locQty(A0101)).toBe(20);
    });

    it("搬移超過來源可用量 → 409", async () => {
      const { batch } = await inbound30();
      const res = await post("/api/stock/transfer", { batchId: batch.id, fromLocationId: A0102, toLocationId: A0103, quantity: 11 });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("INSUFFICIENT_STOCK");
    });
  });

  describe("報損", () => {
    it("AT-19：報損 3 籠，庫存減 3 且留 DAMAGE 紀錄含原因與操作者", async () => {
      const { batch } = await inbound30();
      const res = await post("/api/stock/damage", { batchId: batch.id, locationId: A0101, quantity: 3, reason: "凍傷" });
      expect(res.status).toBe(201);
      expect(await locQty(A0101)).toBe(17);
      const m = await prisma.stockMovement.findFirstOrThrow({ where: { type: "DAMAGE" }, include: { operator: true } });
      expect(m.reason).toBe("凍傷");
      expect(m.operator.username).toBe("staff");
    });

    it("AT-20：超額報損 → 409；原因必填", async () => {
      const { batch } = await inbound30();
      const over = await post("/api/stock/damage", { batchId: batch.id, locationId: A0102, quantity: 11, reason: "x" });
      expect(over.status).toBe(409);
      const noReason = await post("/api/stock/damage", { batchId: batch.id, locationId: A0102, quantity: 1, reason: "" });
      expect(noReason.status).toBe(400);
    });
  });

  describe("容量設定（FR-007）", () => {
    it("依儲位＋商品設定容量；低於目前占用 → 409 CAPACITY_BELOW_OCCUPIED", async () => {
      await inbound30();
      const ok = await request(app).put(`/api/locations/${A0101}/capacities`).set("Cookie", staff).send({ items: [{ productId: cabbage.id, capacity: 25 }] });
      expect(ok.status).toBe(200);
      expect(ok.body.items[0]).toMatchObject({ productId: cabbage.id, capacity: 25 });
      const bad = await request(app).put(`/api/locations/${A0101}/capacities`).set("Cookie", staff).send({ items: [{ productId: cabbage.id, capacity: 19 }] });
      expect(bad.status).toBe(409);
      expect(bad.body.error.code).toBe("CAPACITY_BELOW_OCCUPIED");
      // 提高到 25 後可再放 5
      const more = await post("/api/stock/inbound", { productId: cabbage.id, quantity: 5, expiryDate: "2026-12-31", allocations: [{ locationId: A0101, quantity: 5 }] });
      expect(more.status).toBe(201);
    });

    it("defaultCapacity 設為 null 代表不限制（Q2）", async () => {
      await request(app).put(`/api/locations/${A0103}/capacities`).set("Cookie", staff).send({ defaultCapacity: null }).expect(200);
      const res = await post("/api/stock/inbound", { productId: cabbage.id, quantity: 999, expiryDate: "2026-12-31", allocations: [{ locationId: A0103, quantity: 999 }] });
      expect(res.status).toBe(201);
    });
  });

  describe("資料完整性", () => {
    it("I-3：同 Idempotency-Key 送兩次出庫，只扣一次並回傳相同結果", async () => {
      const { batch } = await inbound30();
      const key = randomUUID();
      const body = { productId: cabbage.id, lines: [{ batchId: batch.id, locationId: A0101, quantity: 4 }] };
      const a = await post("/api/stock/outbound", body, key);
      const b = await post("/api/stock/outbound", body, key);
      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      expect(b.body).toEqual(a.body);
      expect(await locQty(A0101)).toBe(16);
      expect(await prisma.stockMovement.count({ where: { type: "OUT" } })).toBe(1);
    });

    it("I-4：並發 20 筆各扣 1（可用 10）→ 恰好 10 成功、10 個 409、最終 0", async () => {
      const { batch } = await inbound30();
      const results = await Promise.all(
        Array.from({ length: 20 }, () => post("/api/stock/outbound", { productId: cabbage.id, lines: [{ batchId: batch.id, locationId: A0102, quantity: 1 }] })),
      );
      const ok = results.filter((r) => r.status === 201).length;
      const rejected = results.filter((r) => r.status === 409 && r.body.error.code === "INSUFFICIENT_STOCK").length;
      expect(ok).toBe(10);
      expect(rejected).toBe(10);
      expect(await locQty(A0102)).toBe(0);
      expect(await prisma.stockMovement.count({ where: { type: "OUT" } })).toBe(10);
    });

    it("並發入庫批次編號仍唯一", async () => {
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          post("/api/stock/inbound", { productId: cabbage.id, quantity: 1, receivedDate: "2026-09-23", expiryDate: "2026-12-31", allocations: [{ locationId: [A0101, A0102, A0103][i % 3], quantity: 1 }] }),
        ),
      );
      const nos = results.map((r) => r.body.batch?.batchNo);
      expect(results.every((r) => r.status === 201)).toBe(true);
      expect(new Set(nos).size).toBe(8);
    });
  });

  describe("AT-25 異動紀錄與整合情境", () => {
    it("入庫 30 → 搬移 5 → 出庫 10（FEFO）→ 報損 3 ＝ 17，五類中四類可查且數量可追溯", async () => {
      const { batch } = await inbound30();
      await post("/api/stock/transfer", { batchId: batch.id, fromLocationId: A0101, toLocationId: A0103, quantity: 5 }).expect(201);
      expect(await productTotal(cabbage.id)).toBe(30);

      const sug = await post("/api/stock/outbound/suggest", { productId: cabbage.id, quantity: 10 });
      const lines = sug.body.suggestions.filter((s: { take: number }) => s.take > 0).map((s: { batchId: number; locationId: number; take: number }) => ({ batchId: s.batchId, locationId: s.locationId, quantity: s.take }));
      await post("/api/stock/outbound", { productId: cabbage.id, lines }).expect(201);
      expect(await productTotal(cabbage.id)).toBe(20);

      await post("/api/stock/damage", { batchId: batch.id, locationId: A0102, quantity: 3, reason: "壓損" }).expect(201);
      expect(await productTotal(cabbage.id)).toBe(17);

      const stock = await request(app).get(`/api/products/${cabbage.id}/stock`).set("Cookie", staff);
      expect(stock.body.total).toBe(17);
      expect(stock.body.lines.reduce((s: number, l: { quantity: number }) => s + l.quantity, 0)).toBe(17);

      for (const type of ["IN", "TRANSFER", "OUT", "DAMAGE"]) {
        const r = await request(app).get(`/api/movements?type=${type}&productId=${cabbage.id}`).set("Cookie", staff);
        expect(r.status).toBe(200);
        expect(r.body.total).toBeGreaterThan(0);
        for (const m of r.body.items) expect(m.type).toBe(type);
      }
      const all = await request(app).get(`/api/movements?locationId=${A0102}`).set("Cookie", staff);
      // A-01-02：IN 10、OUT（FEFO 取到的部分）、DAMAGE 3
      expect(all.body.items.some((m: { type: string }) => m.type === "DAMAGE")).toBe(true);
      const net = (await prisma.stockMovement.findMany({ where: { productId: cabbage.id } })).reduce((s, m) => {
        if (m.type === "IN") return s + m.quantity;
        if (m.type === "OUT" || m.type === "DAMAGE") return s - m.quantity;
        return s; // TRANSFER 不改總量
      }, 0);
      expect(net).toBe(17);
    });
  });
});
