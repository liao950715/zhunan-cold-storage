import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { prisma } from "../lib/prisma.js";
import { loginAs, resetDb } from "./helpers.js";

const app = createApp();

describe("FR-001 登入與角色", () => {
  beforeAll(resetDb);

  it("AT-01：工作人員可登入並取得身分", async () => {
    const res = await request(app).post("/api/auth/login").send({ username: "staff", password: "staff1234" });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe("STAFF");
    expect(res.headers["set-cookie"][0]).toMatch(/token=.*HttpOnly/);

    const me = await request(app).get("/api/auth/me").set("Cookie", res.headers["set-cookie"]);
    expect(me.body.user.username).toBe("staff");
  });

  it("密碼錯誤回 401，且不洩漏是帳號或密碼錯", async () => {
    const res = await request(app).post("/api/auth/login").send({ username: "staff", password: "wrong" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("未登入存取受保護 API 回 401", async () => {
    const res = await request(app).get("/api/products");
    expect(res.status).toBe(401);
  });

  it("I-5／AT-22 前置：STAFF 直接呼叫使用者管理 API 回 403", async () => {
    const cookie = await loginAs(app, "staff");
    const res = await request(app).get("/api/users").set("Cookie", cookie);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("ADMIN 可建立使用者；停用者不可登入", async () => {
    const cookie = await loginAs(app, "admin");
    const created = await request(app)
      .post("/api/users")
      .set("Cookie", cookie)
      .send({ username: "worker2", password: "secret12", displayName: "工作人員二", role: "STAFF" });
    expect(created.status).toBe(201);
    expect(created.body).not.toHaveProperty("passwordHash");

    const disabled = await request(app).patch(`/api/users/${created.body.id}`).set("Cookie", cookie).send({ status: "DISABLED" });
    expect(disabled.status).toBe(200);
    const login = await request(app).post("/api/auth/login").send({ username: "worker2", password: "secret12" });
    expect(login.status).toBe(401);
  });

  it("I-6／NFR-10：密碼以 bcrypt 雜湊儲存", async () => {
    const u = await prisma.user.findUniqueOrThrow({ where: { username: "staff" } });
    expect(u.passwordHash.startsWith("$2")).toBe(true);
    expect(u.passwordHash).not.toContain("staff1234");
  });
});
