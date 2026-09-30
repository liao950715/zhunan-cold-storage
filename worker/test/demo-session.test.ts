import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { loginAs } from "./helpers.js";

/** I-21：正式站沒有開啟「每個瀏覽器一份示範資料」→ 行為完全不變。示範站模式另見 test-demo/。 */
describe("I-21 正式站不受示範站功能影響", () => {
  it("/api/demo/session 回 demo:false、不發 cookie", async () => {
    const r = await SELF.fetch("http://test/api/demo/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fresh: true }) });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ demo: false });
    expect(r.headers.get("Set-Cookie")).toBeNull();
  });

  it("就算帶了示範資料 cookie，也一律走共用的同一份資料", async () => {
    const a = await loginAs("staff");
    const b = await loginAs("staff");
    b.setCookie("demo_sandbox", "0123456789abcdef0123456789abcdef");
    const baseline = (await a.get("/api/stocktakes/baseline").expect(200)).body.items;
    expect(baseline.length).toBeGreaterThan(0);
    expect((await b.get("/api/stocktakes/baseline").expect(200)).body.items).toEqual(baseline);
  });
});
