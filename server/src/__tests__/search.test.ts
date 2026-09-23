import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { prisma } from "../lib/prisma.js";
import { byCode, loginAs, productByName, resetDb } from "./helpers.js";

const app = createApp();
let cookie: string;

/** Stage 1 尚無入庫 API，直接建立庫存列來測查詢。 */
async function putStock(productName: string, batchNo: string, locationCode: string, qty: number, expiry: string) {
  const admin = await prisma.user.findUniqueOrThrow({ where: { username: "admin" } });
  const product = await productByName(productName);
  const batch = await prisma.batch.upsert({
    where: { batchNo },
    update: {},
    create: { batchNo, productId: product.id, receivedDate: new Date("2026-09-01T00:00:00Z"), expiryDate: new Date(`${expiry}T00:00:00Z`), initialQty: qty, createdById: admin.id },
  });
  const loc = await byCode(locationCode);
  await prisma.inventory.create({ data: { batchId: batch.id, locationId: loc.id, quantity: qty } });
}

describe("FR-019 搜尋與定位、庫存查詢", () => {
  beforeAll(async () => {
    await resetDb();
    cookie = await loginAs(app, "staff");
    await putStock("甘藍菜", "B20260901-001", "A-01-01", 20, "2026-12-01");
    await putStock("甘藍菜", "B20260901-001", "A-01-02", 10, "2026-12-01");
    await putStock("甘藍菜", "B20260910-001", "B-01-01", 5, "2026-11-15");
    await putStock("紅蘿蔔", "B20260905-001", "A-02-01", 7, "2026-10-30");
  });

  it("AT-09：依商品名稱搜尋回傳全部匹配位置與數量", async () => {
    const res = await request(app).get("/api/search?q=甘藍").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.lines).toHaveLength(3);
    const codes = res.body.lines.map((l: { location: { code: string } }) => l.location.code).sort();
    expect(codes).toEqual(["A-01-01", "A-01-02", "B-01-01"]);
    expect(res.body.lines[0].location.warehouseCode).toBeDefined();
  });

  it("AT-09：依批次編號搜尋", async () => {
    const res = await request(app).get("/api/search?q=B20260910").set("Cookie", cookie);
    expect(res.body.lines).toHaveLength(1);
    expect(res.body.lines[0].batch.batchNo).toBe("B20260910-001");
  });

  it("AT-09：依儲位編號搜尋", async () => {
    const res = await request(app).get("/api/search?q=A-02-01").set("Cookie", cookie);
    expect(res.body.lines).toHaveLength(1);
    expect(res.body.lines[0].product.name).toBe("紅蘿蔔");
  });

  it("商品庫存明細：總量與各批次、各儲位（AT-07 批次可區分）", async () => {
    const p = await productByName("甘藍菜");
    const res = await request(app).get(`/api/products/${p.id}/stock`).set("Cookie", cookie);
    expect(res.body.total).toBe(35);
    expect(res.body.batches).toHaveLength(2);
    // FEFO 排序：先到期的批次在前
    expect(res.body.batches[0].batch.batchNo).toBe("B20260910-001");
    expect(res.body.lines).toHaveLength(3);
  });

  it("儲位詳情：目前商品與占用量", async () => {
    const loc = await byCode("A-01-01");
    const res = await request(app).get(`/api/locations/${loc.id}`).set("Cookie", cookie);
    expect(res.body.currentProduct.name).toBe("甘藍菜");
    expect(res.body.occupied).toBe(20);
    expect(res.body.location.defaultCapacity).toBe(20);
  });

  it("批次查詢：可用量與明細", async () => {
    const list = await request(app).get("/api/batches?q=B20260901").set("Cookie", cookie);
    expect(list.body.items[0].available).toBe(30);
    const detail = await request(app).get(`/api/batches/${list.body.items[0].id}`).set("Cookie", cookie);
    expect(detail.body.lines).toHaveLength(2);
    expect(detail.body.expiryDate).toBe("2026-12-01");
  });

  it("冷凍庫布局（唯讀）含儲位占用狀態", async () => {
    const whs = await request(app).get("/api/warehouses").set("Cookie", cookie);
    expect(whs.body.items).toHaveLength(2);
    expect(whs.body.items[0]).toMatchObject({ code: "A", rackCount: 4, locationCount: 24 });
    const layout = await request(app).get(`/api/warehouses/${whs.body.items[0].id}/layout`).set("Cookie", cookie);
    const locs = layout.body.racks.flatMap((r: { locations: unknown[] }) => r.locations) as Array<{ code: string; occupied: boolean; quantity: number; product: { name: string } | null }>;
    const a0101 = locs.find((l) => l.code === "A-01-01")!;
    expect(a0101).toMatchObject({ occupied: true, quantity: 20 });
    expect(a0101.product?.name).toBe("甘藍菜");
    expect(locs.find((l) => l.code === "A-01-03")!.occupied).toBe(false);
  });

  it("I-1：DB CHECK 禁止負數庫存", async () => {
    const inv = await prisma.inventory.findFirstOrThrow();
    await expect(prisma.inventory.update({ where: { id: inv.id }, data: { quantity: -1 } })).rejects.toThrow(/CHECK|constraint/i);
  });
});
