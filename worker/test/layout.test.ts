import { beforeEach, describe, expect, it } from "vitest";
import { Client, loginAs, locationIdByCode, movements } from "./helpers.js";

let c: Client;
let whA: number;
type Layout = { layoutVersion: number; racks: Array<{ id: number; code: string; x: number; y: number; width: number; height: number; locations: Array<{ id: number; code: string; x: number; y: number; width: number; height: number; defaultCapacity: number | null }> }> };

const getLayout = async () => (await c.get(`/api/warehouses/${whA}/layout`)).body as Layout;
const toInput = (l: Layout) => ({ version: l.layoutVersion, racks: l.racks.map((r) => ({ id: r.id, code: r.code, x: r.x, y: r.y, width: r.width, height: r.height, locations: r.locations.map((x) => ({ id: x.id, code: x.code, x: x.x, y: x.y, width: x.width, height: x.height, defaultCapacity: x.defaultCapacity })) })) });
const put = (body: unknown) => c.put(`/api/warehouses/${whA}/layout`, body);

describe("FR-005 布局編輯", () => {
  beforeEach(async () => {
    c = await loginAs("staff");
    whA = (await c.get("/api/warehouses")).body.items.find((w: any) => w.code === "A").id;
  });

  it("AT-15：工作人員可新增貨架（含儲位）並拖曳既有貨架，配置保存成功", async () => {
    const l = await getLayout();
    const input = toInput(l);
    input.racks[0].x = 300;
    input.racks.push({ code: "05", x: 600, y: 300, width: 200, height: 100, locations: [{ code: "A-05-01", x: 0, y: 0, width: 100, height: 100, defaultCapacity: 10 }] } as never);
    const r = await put(input);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.layoutVersion).toBe(l.layoutVersion + 1);
    const after = await getLayout();
    expect(after.racks).toHaveLength(5);
    expect(after.racks.find((x) => x.code === "01")!.x).toBe(300);
    expect(after.racks.find((x) => x.code === "05")!.locations[0].code).toBe("A-05-01");
  });

  it("AT-16／I-7：拖曳儲位後庫存與異動紀錄完全不變", async () => {
    const before = { stock: (await c.get("/api/search?q=紅蘿蔔")).body.lines, mov: await movements(c) };
    const input = toInput(await getLayout());
    input.racks[0].locations[0].x = 20;
    input.racks[0].locations[0].y = 10;
    await put(input).expect(200);
    const after = await getLayout();
    expect(after.racks[0].locations[0]).toMatchObject({ code: "A-01-01", x: 20, y: 10 });
    expect((await c.get("/api/search?q=紅蘿蔔")).body.lines).toEqual(before.stock);
    expect(await movements(c)).toEqual(before.mov);
  });

  it("AT-17：刪除有庫存儲位／貨架 → 409 LOCATION_NOT_EMPTY；清空後可刪且為軟刪除、代碼不可重用", async () => {
    const stocked = await locationIdByCode(c, "A-01-01");
    const r1 = await c.delete(`/api/locations/${stocked}`);
    expect(r1.status).toBe(409);
    expect(r1.body.error.code).toBe("LOCATION_NOT_EMPTY");
    const rackId = (await getLayout()).racks[0].id;
    const r2 = await c.delete(`/api/racks/${rackId}`);
    expect(r2.status).toBe(409);
    expect(r2.body.error.message).toContain("A-01-01");

    const empty = await locationIdByCode(c, "A-01-03");
    await c.delete(`/api/locations/${empty}`).expect(200);
    const l = await getLayout();
    expect(l.racks[0].locations.map((x) => x.code)).not.toContain("A-01-03");
    const input = toInput(l);
    input.racks[0].locations.push({ code: "A-01-03", x: 0, y: 0, width: 10, height: 10 } as never);
    expect((await put(input)).status).toBe(409);
  });

  it("越界貨架／儲位、代碼重複 → 400；版本不符 → 409；儲位不可跨貨架", async () => {
    const input = toInput(await getLayout());
    const bad1 = structuredClone(input); bad1.racks[0].x = 1100;
    expect((await put(bad1)).status).toBe(400);
    const bad2 = structuredClone(input); bad2.racks[0].locations[0].x = 400;
    expect((await put(bad2)).status).toBe(400);
    const bad3 = structuredClone(input); bad3.racks[1].code = bad3.racks[0].code;
    expect((await put(bad3)).status).toBe(400);
    const moved = structuredClone(input); moved.racks[1].locations.push(moved.racks[0].locations.pop()!);
    expect((await put(moved)).status).toBe(400);
    await put(input).expect(200);
    const stale = await put(input);
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("CONCURRENT_UPDATE");
  });
});
