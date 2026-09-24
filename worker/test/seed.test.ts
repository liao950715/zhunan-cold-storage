import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { loginAs } from "./helpers.js";

type Layout = { racks: Array<{ locations: Array<{ code: string; occupied: boolean; quantity: number; capacity: number | null; batchCount: number }> }> };

describe("示範站種子資料（DEMO_MODE=rich，Cron 重置走同一條路）", () => {
  it("填滿 37 格、留 5 格空位；全部走正式入庫規則，不超容量、一儲位一商品；含快到期與已過期批次", async () => {
    const stub = env.WAREHOUSE.get(env.WAREHOUSE.idFromName("main"));
    expect(await stub.resetFromCron("rich")).toEqual({ ok: true });
    const c = await loginAs("admin");
    const whs = (await c.get("/api/warehouses").expect(200)).body.items as Array<{ id: number }>;
    const locs = (await Promise.all(whs.map(async (w) => ((await c.get(`/api/warehouses/${w.id}/layout`).expect(200)).body as Layout).racks.flatMap((r) => r.locations)))).flat();
    expect(locs).toHaveLength(42);
    expect(locs.filter((l) => l.occupied)).toHaveLength(37);
    expect(locs.filter((l) => !l.occupied).map((l) => l.code).sort()).toEqual(["A-04-05", "A-04-06", "B-03-04", "B-03-05", "B-03-06"]);
    for (const l of locs) expect(l.quantity, l.code).toBeLessThanOrEqual(l.capacity ?? Infinity);
    const batches = (await c.get("/api/batches").expect(200)).body.items as Array<{ expiryDate: string }>;
    expect(batches).toHaveLength(26);
    const today = new Date().toISOString().slice(0, 10);
    expect(batches.filter((b) => b.expiryDate < today).length).toBeGreaterThanOrEqual(1);
    // 重置回 basic 不影響其他測試（isolatedStorage 也會還原）
    await stub.resetFromCron("basic");
  });
});
