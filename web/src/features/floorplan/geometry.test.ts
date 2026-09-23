import { describe, expect, it } from "vitest";
import { clampRect, defaultLocations, findRackOverlaps, nextLocationCode, nextRackCode, toPayload } from "./geometry";
import type { DraftRack } from "../../api/types";

const rack = (code: string, x: number, y: number): DraftRack => ({ key: code, code, label: null, x, y, width: 100, height: 50, locations: [] });

describe("floorplan geometry", () => {
  it("clampRect 把圖形限制在邊界內", () => {
    expect(clampRect({ x: -5, y: 790, width: 100, height: 50 }, 1200, 800)).toEqual({ x: 0, y: 750, width: 100, height: 50 });
  });

  it("findRackOverlaps 找出重疊配對（只警告）", () => {
    expect(findRackOverlaps([rack("01", 0, 0), rack("02", 50, 10), rack("03", 500, 0)])).toEqual([["01", "02"]]);
  });

  it("nextRackCode／nextLocationCode 依序取號且避開既有代碼", () => {
    expect(nextRackCode([rack("01", 0, 0), rack("03", 0, 0)])).toBe("04");
    expect(nextLocationCode("A", rack("05", 0, 0), new Set(["A-05-01"]))).toBe("A-05-02");
  });

  it("defaultLocations 產生 3×2 儲位並填滿貨架", () => {
    const r = { ...rack("05", 0, 0), width: 300, height: 200 };
    const locs = defaultLocations("A", r, new Set());
    expect(locs).toHaveLength(6);
    expect(locs.map((l) => l.code)).toEqual(["A-05-01", "A-05-02", "A-05-03", "A-05-04", "A-05-05", "A-05-06"]);
    expect(locs[5]).toMatchObject({ x: 200, y: 100, width: 100, height: 100 });
  });

  it("toPayload 去除前端顯示欄位", () => {
    const r = rack("01", 0, 0);
    r.locations.push({ id: 9, code: "A-01-01", x: 0, y: 0, width: 10, height: 10, defaultCapacity: 20, occupied: true, quantity: 5, product: { id: 1, name: "x", unit: "籠" } });
    const p = toPayload(3, [r]);
    expect(p.version).toBe(3);
    expect(p.racks[0]).not.toHaveProperty("key");
    expect(p.racks[0].locations[0]).toEqual({ id: 9, code: "A-01-01", x: 0, y: 0, width: 10, height: 10, defaultCapacity: 20 });
  });
});
