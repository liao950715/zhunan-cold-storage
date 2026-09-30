import { env, runDurableObjectAlarm, runInDurableObject, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { Client, locationIdByCode, locQty, productByName } from "../test/helpers.js";

/**
 * I-22 示範站：每個瀏覽器各一份示範資料（DEMO_SANDBOX=per-browser）。
 * 第一次開啟給一份新的；重新整理／按「重置示範資料」（fresh）且資料改過 → 換一份新的；閒置 6 小時自動刪除。
 */
const ACCOUNTS = { admin: { username: "admin", password: "admin1234" }, staff: { username: "staff", password: "staff1234" } };
const session = (c: Client, fresh = false) => c.post<{ demo: boolean; created: boolean }>("/api/demo/session", { fresh }).expect(200);
const login = (c: Client, who: keyof typeof ACCOUNTS) => c.post("/api/auth/login", ACCOUNTS[who]).expect(200);

/** 模擬一個新的瀏覽器：開頁（拿到自己的示範資料）＋登入 */
async function openBrowser(who: keyof typeof ACCOUNTS = "admin") {
  const c = new Client();
  expect((await session(c)).body).toEqual({ demo: true, created: true });
  await login(c, who);
  return c;
}
const occupied = async (c: Client, code: string) => locQty(c, await locationIdByCode(c, code));
async function inboundTo(c: Client, code: string, quantity: number, status = 201) {
  const p = await productByName(c, "甘藍菜");
  return c.post("/api/stock/inbound", { productId: p.id, quantity, expiryDate: "2099-12-31", allocations: [{ locationId: await locationIdByCode(c, code), quantity }] }).expect(status);
}
const sandboxStub = (c: Client) => env.WAREHOUSE.get(env.WAREHOUSE.idFromName(`sandbox:${c.cookie("demo_sandbox")}`));

describe("I-22 示範站：每個瀏覽器各一份示範資料", () => {
  it("第一次開啟：發一份新的示範資料（cookie），內容是完整示範資料，不需同步碼就能登入", async () => {
    const c = new Client();
    const r = await session(c);
    expect(r.body).toEqual({ demo: true, created: true });
    expect(r.headers.get("Set-Cookie")).toMatch(/^demo_sandbox=[0-9a-f]{32}; Path=\/; HttpOnly; Secure; SameSite=Lax$/);
    await login(c, "admin");
    expect((await c.get("/api/dashboard").expect(200)).body.stats).toMatchObject({ occupiedLocations: 39, totalLocations: 42 });
  });

  it("不同瀏覽器互不影響：A 入庫，B 看不到", async () => {
    const a = await openBrowser();
    const b = await openBrowser("staff");
    expect(a.cookie("demo_sandbox")).not.toBe(b.cookie("demo_sandbox"));
    await inboundTo(a, "A-04-05", 5);
    expect(await occupied(a, "A-04-05")).toBe(5);
    expect(await occupied(b, "A-04-05")).toBe(0);
  });

  it("同一個瀏覽器：一般開頁沿用同一份；沒改過就重新整理不必重建；改過再重新整理 → 換新的一份、回到初始資料、仍保持登入", async () => {
    const a = await openBrowser();
    const first = a.cookie("demo_sandbox");
    expect((await session(a, false)).body.created).toBe(false);
    expect((await session(a, true)).body.created).toBe(false); // 沒改過的那份本來就是初始資料
    const carrot = await productByName(a, "紅蘿蔔");
    await a.post("/api/stock/outbound/suggest", { productId: carrot.id, quantity: 1 }).expect(200); // 只是查詢，不算改過
    await inboundTo(a, "A-04-05", 25, 409); // 被拒絕的操作也不算改過（容量 20）
    expect((await session(a, true)).body.created).toBe(false);
    expect(a.cookie("demo_sandbox")).toBe(first);

    await inboundTo(a, "A-04-05", 5);
    expect((await session(a, false)).body.created).toBe(false); // 一般開頁（例如開新分頁）：保留剛剛的操作
    expect(await occupied(a, "A-04-05")).toBe(5);
    expect((await session(a, true)).body.created).toBe(true); // 重新整理
    expect(a.cookie("demo_sandbox")).not.toBe(first);
    expect(await occupied(a, "A-04-05")).toBe(0);
    expect((await a.get("/api/auth/me").expect(200)).body.user.username).toBe("admin");
  });

  it("管理員「重置為展示資料」只重置自己這份，並算回「沒改過」", async () => {
    const a = await openBrowser();
    const b = await openBrowser();
    await inboundTo(a, "A-04-05", 5);
    await inboundTo(b, "A-04-06", 4);
    await a.post("/api/admin/reset-demo", { confirm: "RESET" }).expect(200);
    expect(await occupied(a, "A-04-05")).toBe(0);
    expect(await occupied(b, "A-04-06")).toBe(4);
    expect((await session(a, true)).body.created).toBe(false);
  });

  it("閒置 6 小時自動刪除：整份資料清掉；同一個瀏覽器再來會自動重建初始資料", async () => {
    const a = await openBrowser();
    await inboundTo(a, "A-04-05", 5);
    const stub = sandboxStub(a);
    const due = await runInDurableObject(stub, (_instance, state) => state.storage.getAlarm());
    expect(due! - Date.now()).toBeGreaterThan(5.5 * 3_600_000);
    expect(due! - Date.now()).toBeLessThanOrEqual(6 * 3_600_000);
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const tables = await runInDurableObject(stub, (_instance, state) => state.storage.sql.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'Inventory'").toArray().length);
    expect(tables).toBe(0);
    expect(await occupied(a, "A-04-05")).toBe(0);
    expect((await a.get("/api/auth/me").expect(200)).body.user.username).toBe("admin");
  });

  it("沒帶 cookie（curl、腳本）或 cookie 格式不對 → 共用的那一份；有自己那份的瀏覽器不受影響", async () => {
    const main = env.WAREHOUSE.get(env.WAREHOUSE.idFromName("main"));
    await main.resetFromCron("rich");
    const x = new Client();
    await login(x, "admin");
    const y = new Client();
    y.setCookie("demo_sandbox", "../../not-a-sandbox");
    await login(y, "admin");
    await inboundTo(x, "A-04-05", 3);
    expect(await occupied(y, "A-04-05")).toBe(3);
    const a = await openBrowser();
    expect(await occupied(a, "A-04-05")).toBe(0);
    await main.resetFromCron("rich");
  });

  it("只收 JSON 的 POST（別的網站無法用表單偷送來換掉訪客的示範資料）", async () => {
    const form = await SELF.fetch("http://test/api/demo/session", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "fresh=true" });
    expect(form.status).toBe(415);
    expect(form.headers.get("Set-Cookie")).toBeNull();
    expect((await SELF.fetch("http://test/api/demo/session")).status).toBe(404);
  });

  it("示範站照樣守權限：工作人員不能核准盤點、不能重置", async () => {
    const s = await openBrowser("staff");
    const st = (await s.get("/api/stocktakes/baseline").expect(200)).body.items[0];
    const created = (await s.post("/api/stocktakes", { items: [{ locationId: st.locationId, batchId: st.batchId, systemQty: st.systemQty, countedQty: st.systemQty }] }).expect(201)).body;
    expect((await s.post(`/api/stocktakes/${created.id}/approve`, {})).status).toBe(403);
    expect((await s.post("/api/admin/reset-demo", { confirm: "RESET" })).status).toBe(403);
  });
});
