import { describe, expect, it } from "vitest";
import { Client, SYNC_CODE, loginAs, pairedClient } from "./helpers.js";

describe("裝置配對（同步碼）與 FR-001 登入角色", () => {
  it("未配對的裝置不能登入或呼叫 API（NOT_PAIRED）", async () => {
    const c = new Client();
    const r = await c.post("/api/auth/login", { username: "staff", password: "staff1234" });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe("NOT_PAIRED");
    expect((await c.get("/api/pair")).body.paired).toBe(false);
  });

  it("同步碼錯誤 401；正確則配對成功並可查詢狀態", async () => {
    const c = new Client();
    expect((await c.post("/api/pair", { code: "wrong-code" })).status).toBe(401);
    await c.post("/api/pair", { code: SYNC_CODE }).expect(200);
    expect((await c.get("/api/pair")).body.paired).toBe(true);
  });

  it("同步碼連續錯 8 次後被節流（429）", async () => {
    const c = new Client();
    for (let i = 0; i < 8; i++) await c.post("/api/pair", { code: "wrong" });
    const r = await c.post("/api/pair", { code: SYNC_CODE });
    expect(r.status).toBe(429);
    expect(r.body.error.code).toBe("TOO_MANY_ATTEMPTS");
  });

  it("AT-01：工作人員可登入並取得身分（HttpOnly cookie）", async () => {
    const c = await pairedClient();
    const res = await c.post("/api/auth/login", { username: "staff", password: "staff1234" });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe("STAFF");
    expect(res.headers.getSetCookie().some((s) => /token=.*HttpOnly/.test(s))).toBe(true);
    expect((await c.get("/api/auth/me")).body.user.username).toBe("staff");
  });

  it("密碼錯誤回 401，且不洩漏是帳號或密碼錯", async () => {
    const c = await pairedClient();
    const r = await c.post("/api/auth/login", { username: "staff", password: "wrong" });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("已配對但未登入存取受保護 API 回 401", async () => {
    const c = await pairedClient();
    expect((await c.get("/api/products")).status).toBe(401);
  });

  it("I-5／AT-22 前置：STAFF 直接呼叫使用者管理 API 回 403", async () => {
    const c = await loginAs("staff");
    const r = await c.get("/api/users");
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("FORBIDDEN");
  });

  it("ADMIN 可建立使用者；停用者不可登入；密碼不回傳（I-6）", async () => {
    const admin = await loginAs("admin");
    const created = await admin.post("/api/users", { username: "worker2", password: "secret12", displayName: "工作人員二", role: "STAFF" });
    expect(created.status).toBe(201);
    expect(created.body).not.toHaveProperty("passwordHash");
    const c = await pairedClient();
    await c.post("/api/auth/login", { username: "worker2", password: "secret12" }).expect(200);
    await admin.patch(`/api/users/${created.body.id}`, { status: "DISABLED" }).expect(200);
    const c2 = await pairedClient();
    expect((await c2.post("/api/auth/login", { username: "worker2", password: "secret12" })).status).toBe(401);
    // 已登入但被停用的 session 也失效
    expect((await c.get("/api/auth/me")).status).toBe(401);
  });
});
