import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { prisma } from "../lib/prisma.js";
import { loginAs, resetDb, productByName } from "./helpers.js";

const app = createApp();
let staff: string;

describe("FR-002 商品管理", () => {
  beforeAll(async () => {
    await resetDb();
    staff = await loginAs(app, "staff");
  });

  it("AT-01：工作人員可新增商品（含單位、警戒值、提醒天數）", async () => {
    const res = await request(app)
      .post("/api/products")
      .set("Cookie", staff)
      .send({ name: "小黃瓜", category: "瓜果", unit: "箱", lowStockThreshold: 5, expiryAlertDays: 7 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: "小黃瓜", unit: "箱", status: "ACTIVE" });
  });

  it("欄位缺漏回 400 VALIDATION_ERROR", async () => {
    const res = await request(app).post("/api/products").set("Cookie", staff).send({ name: "" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("名稱重複回 409", async () => {
    const res = await request(app).post("/api/products").set("Cookie", staff).send({ name: "甘藍菜", unit: "籠" });
    expect(res.status).toBe(409);
  });

  it("停用商品後預設清單不顯示，includeInactive 才顯示", async () => {
    const p = await productByName("香蕉");
    await request(app).patch(`/api/products/${p.id}`).set("Cookie", staff).send({ status: "INACTIVE" }).expect(200);
    const list = await request(app).get("/api/products").set("Cookie", staff);
    expect(list.body.items.map((x: { name: string }) => x.name)).not.toContain("香蕉");
    const all = await request(app).get("/api/products?includeInactive=true").set("Cookie", staff);
    expect(all.body.items.map((x: { name: string }) => x.name)).toContain("香蕉");
  });

  it("Q8：已有批次的商品不可改單位（UNIT_LOCKED），改名允許", async () => {
    const p = await productByName("紅蘿蔔");
    const admin = await prisma.user.findUniqueOrThrow({ where: { username: "admin" } });
    await prisma.batch.create({
      data: { batchNo: "B20260901-001", productId: p.id, receivedDate: new Date(), expiryDate: new Date(), initialQty: 5, createdById: admin.id },
    });
    const bad = await request(app).patch(`/api/products/${p.id}`).set("Cookie", staff).send({ unit: "公斤" });
    expect(bad.status).toBe(409);
    expect(bad.body.error.code).toBe("UNIT_LOCKED");
    const ok = await request(app).patch(`/api/products/${p.id}`).set("Cookie", staff).send({ name: "紅蘿蔔（進口）" });
    expect(ok.status).toBe(200);
    expect(ok.body.unit).toBe("箱");
  });

  it("?q= 可依名稱搜尋商品", async () => {
    const res = await request(app).get("/api/products?q=菜").set("Cookie", staff);
    expect(res.body.items.length).toBeGreaterThan(0);
    for (const p of res.body.items) expect(p.name).toContain("菜");
  });
});
