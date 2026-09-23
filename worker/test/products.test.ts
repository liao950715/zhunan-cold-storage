import { describe, expect, it } from "vitest";
import { loginAs, locationIdByCode, productByName } from "./helpers.js";

describe("FR-002 商品管理、FR-019 搜尋", () => {
  it("AT-01：工作人員可新增商品；欄位缺漏 400；名稱重複 409", async () => {
    const c = await loginAs("staff");
    const r = await c.post("/api/products", { name: "小黃瓜", category: "瓜果", unit: "箱", lowStockThreshold: 5, expiryAlertDays: 7 });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ name: "小黃瓜", unit: "箱", status: "ACTIVE" });
    expect((await c.post("/api/products", { name: "" })).body.error.code).toBe("VALIDATION_ERROR");
    expect((await c.post("/api/products", { name: "甘藍菜", unit: "籠" })).status).toBe(409);
  });

  it("停用商品後預設清單不顯示，includeInactive 才顯示；停用商品不可入庫", async () => {
    const c = await loginAs("staff");
    const p = await productByName(c, "香蕉");
    await c.patch(`/api/products/${p.id}`, { status: "INACTIVE" }).expect(200);
    expect((await c.get("/api/products")).body.items.map((x: any) => x.name)).not.toContain("香蕉");
    expect((await c.get("/api/products?includeInactive=true")).body.items.map((x: any) => x.name)).toContain("香蕉");
    const loc = await locationIdByCode(c, "A-01-03");
    expect((await c.post("/api/stock/inbound", { productId: p.id, quantity: 1, expiryDate: "2026-12-31", allocations: [{ locationId: loc, quantity: 1 }] })).status).toBe(409);
  });

  it("Q8：已有批次的商品不可改單位（UNIT_LOCKED），改名允許", async () => {
    const c = await loginAs("staff");
    const p = await productByName(c, "紅蘿蔔"); // seed 已有批次
    const bad = await c.patch(`/api/products/${p.id}`, { unit: "公斤" });
    expect(bad.status).toBe(409);
    expect(bad.body.error.code).toBe("UNIT_LOCKED");
    const ok = await c.patch(`/api/products/${p.id}`, { name: "紅蘿蔔（進口）" });
    expect(ok.status).toBe(200);
    expect(ok.body.unit).toBe("箱");
    // 歷史紀錄保留原名快照，並可用 id 追溯
    const m = await c.get(`/api/movements?productId=${p.id}`);
    expect(m.body.items[0].productNameSnapshot).toBe("紅蘿蔔");
  });

  it("AT-09：依商品名稱／批次編號／儲位編號搜尋回傳全部匹配位置", async () => {
    const c = await loginAs("staff");
    const byName = await c.get("/api/search?q=紅蘿蔔");
    expect(byName.body.lines.map((l: any) => l.location.code).sort()).toEqual(["A-01-01", "A-01-02"]);
    const batchNo = byName.body.lines[0].batch.batchNo;
    expect((await c.get(`/api/search?q=${batchNo}`)).body.lines).toHaveLength(2);
    const byLoc = await c.get("/api/search?q=B-02-01");
    expect(byLoc.body.lines).toHaveLength(1);
    expect(byLoc.body.lines[0].product.name).toBe("毛豆");
  });

  it("商品庫存明細、儲位詳情、批次查詢、冷凍庫布局", async () => {
    const c = await loginAs("staff");
    const carrot = await productByName(c, "紅蘿蔔");
    const stock = await c.get(`/api/products/${carrot.id}/stock`);
    expect(stock.body.total).toBe(20);
    expect(stock.body.batches).toHaveLength(1);
    expect(stock.body.lines).toHaveLength(2);

    const loc = await locationIdByCode(c, "A-01-01");
    const d = await c.get(`/api/locations/${loc}`);
    expect(d.body.currentProduct.name).toBe("紅蘿蔔");
    expect(d.body).toMatchObject({ occupied: 12 });
    expect(d.body.location.defaultCapacity).toBe(20);

    const batches = await c.get(`/api/batches?productId=${carrot.id}`);
    expect(batches.body.items[0].available).toBe(20);
    const detail = await c.get(`/api/batches/${batches.body.items[0].id}`);
    expect(detail.body.lines).toHaveLength(2);

    const whs = await c.get("/api/warehouses");
    expect(whs.body.items).toHaveLength(2);
    expect(whs.body.items[0]).toMatchObject({ code: "A", rackCount: 4, locationCount: 24 });
    const layout = await c.get(`/api/warehouses/${whs.body.items[0].id}/layout`);
    const locs = layout.body.racks.flatMap((r: any) => r.locations);
    expect(locs.find((l: any) => l.code === "A-01-01")).toMatchObject({ occupied: true, quantity: 12, product: { name: "紅蘿蔔" } });
    expect(locs.find((l: any) => l.code === "A-01-03").occupied).toBe(false);
  });
});
