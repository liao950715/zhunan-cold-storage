import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { prisma } from "../lib/prisma.js";
import { byCode, loginAs, productByName, resetDb } from "./helpers.js";

const app = createApp();
let staff: string;
let whA: number;

type Layout = { layoutVersion: number; width: number; height: number; racks: Array<{ id: number; code: string; x: number; y: number; width: number; height: number; locations: Array<{ id: number; code: string; x: number; y: number; width: number; height: number; defaultCapacity: number | null }> }> };

const getLayout = async () => (await request(app).get(`/api/warehouses/${whA}/layout`).set("Cookie", staff)).body as Layout;
const toInput = (l: Layout) => ({
  version: l.layoutVersion,
  racks: l.racks.map((r) => ({ id: r.id, code: r.code, x: r.x, y: r.y, width: r.width, height: r.height, locations: r.locations.map((x) => ({ id: x.id, code: x.code, x: x.x, y: x.y, width: x.width, height: x.height, defaultCapacity: x.defaultCapacity })) })),
});
const put = (body: unknown) => request(app).put(`/api/warehouses/${whA}/layout`).set("Cookie", staff).send(body);

async function stockA0101(qty = 5) {
  const p = await productByName("甘藍菜");
  const loc = await byCode("A-01-01");
  return request(app).post("/api/stock/inbound").set("Cookie", staff).send({ productId: p.id, quantity: qty, expiryDate: "2026-12-31", allocations: [{ locationId: loc.id, quantity: qty }] }).expect(201);
}

describe("FR-005 布局編輯", () => {
  beforeEach(async () => {
    await resetDb();
    staff = await loginAs(app, "staff");
    whA = (await prisma.warehouse.findUniqueOrThrow({ where: { code: "A" } })).id;
  });

  it("AT-15：工作人員可新增貨架（含儲位）並拖曳既有貨架，配置保存成功", async () => {
    const l = await getLayout();
    const input = toInput(l);
    input.racks[0].x = 300; // 拖曳
    input.racks.push({ code: "05", x: 600, y: 300, width: 200, height: 100, locations: [{ code: "A-05-01", x: 0, y: 0, width: 100, height: 100, defaultCapacity: 10 }] } as never);
    const res = await put(input);
    expect(res.status).toBe(200);
    expect(res.body.layoutVersion).toBe(l.layoutVersion + 1);
    const after = await getLayout();
    expect(after.racks).toHaveLength(5);
    expect(after.racks.find((r) => r.code === "01")!.x).toBe(300);
    expect(after.racks.find((r) => r.code === "05")!.locations[0].code).toBe("A-05-01");
  });

  it("AT-16／I-7：拖曳儲位後庫存與異動紀錄完全不變", async () => {
    await stockA0101();
    const before = { inv: await prisma.inventory.findMany(), mov: await prisma.stockMovement.findMany() };
    const input = toInput(await getLayout());
    input.racks[0].locations[0].x = 20;
    input.racks[0].locations[0].y = 10;
    await put(input).expect(200);
    const after = await getLayout();
    expect(after.racks[0].locations[0]).toMatchObject({ code: "A-01-01", x: 20, y: 10 });
    expect(await prisma.inventory.findMany()).toEqual(before.inv);
    expect(await prisma.stockMovement.findMany()).toEqual(before.mov);
  });

  it("AT-17：刪除有庫存儲位／貨架 → 409 LOCATION_NOT_EMPTY；清空後可刪且為軟刪除", async () => {
    await stockA0101();
    const loc = await byCode("A-01-01");
    const r1 = await request(app).delete(`/api/locations/${loc.id}`).set("Cookie", staff);
    expect(r1.status).toBe(409);
    expect(r1.body.error.code).toBe("LOCATION_NOT_EMPTY");
    const r2 = await request(app).delete(`/api/racks/${loc.rackId}`).set("Cookie", staff);
    expect(r2.status).toBe(409);
    expect(r2.body.error.message).toContain("A-01-01");

    const empty = await byCode("A-01-02");
    await request(app).delete(`/api/locations/${empty.id}`).set("Cookie", staff).expect(200);
    expect((await prisma.location.findUniqueOrThrow({ where: { id: empty.id } })).status).toBe("ARCHIVED");
    const l = await getLayout();
    expect(l.racks[0].locations.map((x) => x.code)).not.toContain("A-01-02");
    // 已封存代碼不可重用
    const input = toInput(l);
    input.racks[0].locations.push({ code: "A-01-02", x: 0, y: 0, width: 10, height: 10 } as never);
    expect((await put(input)).status).toBe(409);
  });

  it("越界貨架／儲位、代碼重複 → 400", async () => {
    const input = toInput(await getLayout());
    const bad1 = structuredClone(input);
    bad1.racks[0].x = 1100; // 1100 + 480 > 1200
    expect((await put(bad1)).status).toBe(400);
    const bad2 = structuredClone(input);
    bad2.racks[0].locations[0].x = 400; // 400 + 160 > 480
    expect((await put(bad2)).status).toBe(400);
    const bad3 = structuredClone(input);
    bad3.racks[1].code = bad3.racks[0].code;
    expect((await put(bad3)).status).toBe(400);
  });

  it("版本不符 → 409 CONCURRENT_UPDATE", async () => {
    const input = toInput(await getLayout());
    await put(input).expect(200);
    const stale = await put(input);
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("CONCURRENT_UPDATE");
  });

  it("儲位不可透過布局跨貨架移動", async () => {
    const input = toInput(await getLayout());
    const moved = input.racks[0].locations.pop()!;
    input.racks[1].locations.push(moved);
    const res = await put(input);
    expect(res.status).toBe(400);
  });
});
