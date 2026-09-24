/**
 * 示範種子資料（模擬，不是案例公司真實資料）。DO 第一次啟動且沒有使用者時執行。
 */
import type { Db } from "./lib/sql.js";
import { hashPassword } from "./lib/crypto.js";
import { inbound } from "./services/stockService.js";

export const DEMO_ACCOUNTS = {
  admin: { username: "admin", password: "admin1234", displayName: "李太太（管理員）", role: "ADMIN" as const },
  staff: { username: "staff", password: "staff1234", displayName: "倉庫工作人員", role: "STAFF" as const },
};

export const DEMO_PRODUCTS: ReadonlyArray<readonly [string, string, string, number, number]> = [
  ["甘藍菜", "葉菜", "籠", 10, 14], ["高麗菜", "葉菜", "籠", 10, 14], ["大白菜", "葉菜", "籠", 8, 14],
  ["青花菜", "花菜", "箱", 10, 10], ["花椰菜", "花菜", "箱", 10, 10], ["紅蘿蔔", "根莖", "箱", 15, 30],
  ["白蘿蔔", "根莖", "箱", 10, 30], ["馬鈴薯", "根莖", "箱", 20, 45], ["芋頭", "根莖", "箱", 5, 45],
  ["毛豆", "豆類", "公斤", 50, 30], ["玉米", "穀類", "箱", 10, 20], ["竹筍", "筍類", "籠", 5, 10],
  ["南瓜", "瓜果", "箱", 8, 45], ["冬瓜", "瓜果", "箱", 5, 30], ["絲瓜", "瓜果", "箱", 5, 10],
  ["草莓", "水果", "箱", 10, 7], ["芒果", "水果", "箱", 10, 10], ["鳳梨", "水果", "箱", 10, 14],
  ["荔枝", "水果", "箱", 8, 7], ["香蕉", "水果", "箱", 10, 7],
];

/** 帳號、兩座冷凍庫（A 4 架、B 3 架，各 6 儲位）、20 種商品。 */
export async function seedBase(db: Db) {
  for (const a of Object.values(DEMO_ACCOUNTS)) {
    db.run("INSERT OR IGNORE INTO User (username, passwordHash, displayName, role) VALUES (?, ?, ?, ?)", a.username, await hashPassword(a.password), a.displayName, a.role);
  }
  const layout = JSON.stringify({ entrance: { x: 0, y: 340, width: 40, height: 120 }, aisles: [{ x: 40, y: 340, width: 1160, height: 120 }] });
  for (const w of [{ code: "A", name: "冷凍庫 A", racks: 4 }, { code: "B", name: "冷凍庫 B", racks: 3 }]) {
    db.run("INSERT OR IGNORE INTO Warehouse (code, name, width, height, layoutJson) VALUES (?, ?, 1200, 800, ?)", w.code, w.name, layout);
    const whId = db.one<{ id: number }>("SELECT id FROM Warehouse WHERE code = ?", w.code)!.id;
    for (let r = 1; r <= w.racks; r++) {
      const rackCode = String(r).padStart(2, "0");
      const x = 80 + ((r - 1) % 2) * 560;
      const y = r <= 2 ? 80 : 500;
      db.run("INSERT OR IGNORE INTO Rack (warehouseId, code, label, x, y, width, height) VALUES (?, ?, ?, ?, ?, 480, 200)", whId, rackCode, `貨架 ${rackCode}`, x, y);
      const rackId = db.one<{ id: number }>("SELECT id FROM Rack WHERE warehouseId = ? AND code = ?", whId, rackCode)!.id;
      for (let l = 1; l <= 6; l++) {
        const code = `${w.code}-${rackCode}-${String(l).padStart(2, "0")}`;
        db.run("INSERT OR IGNORE INTO Location (rackId, code, x, y, width, height, defaultCapacity) VALUES (?, ?, ?, ?, 160, 100, 20)", rackId, code, ((l - 1) % 3) * 160, l <= 3 ? 0 : 100);
      }
    }
  }
  for (const [name, category, unit, low, days] of DEMO_PRODUCTS) {
    db.run("INSERT OR IGNORE INTO Product (name, category, unit, lowStockThreshold, expiryAlertDays) VALUES (?, ?, ?, ?, ?)", name, category, unit, low, days);
  }
}

/** 展示用初始庫存：走正式入庫服務，遵守全部規則；只在尚無批次時執行。mode=rich：示範站用，儲位幾乎填滿、看起來像真的在營運。 */
export function seedDemoStock(db: Db, mode: "basic" | "rich" = "basic") {
  if (db.one<{ n: number }>("SELECT COUNT(*) AS n FROM Batch")!.n > 0) return;
  const admin = db.one<{ id: number }>("SELECT id FROM User WHERE username = 'admin'")!;
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  type Row = { product: string; receivedOffset: number; expiryOffset: number; allocations: Array<[string, number]> };
  const basic: Row[] = [
    { product: "紅蘿蔔", receivedOffset: -22, expiryOffset: 20, allocations: [["A-01-01", 12], ["A-01-02", 8]] },
    { product: "馬鈴薯", receivedOffset: -18, expiryOffset: 40, allocations: [["A-02-01", 18]] },
    { product: "草莓", receivedOffset: -3, expiryOffset: 3, allocations: [["B-01-01", 6]] },
    { product: "毛豆", receivedOffset: -13, expiryOffset: 25, allocations: [["B-02-01", 15]] },
  ];
  // 示範站：42 格填 37 格、留 5 格空位；同商品多批次、幾批快到期、一批已過期
  const rich: Row[] = [
    { product: "甘藍菜", receivedOffset: -20, expiryOffset: 12, allocations: [["A-01-01", 20], ["A-01-02", 14]] },
    { product: "甘藍菜", receivedOffset: -6, expiryOffset: 28, allocations: [["A-01-02", 6], ["A-01-03", 18]] },
    { product: "高麗菜", receivedOffset: -15, expiryOffset: 18, allocations: [["A-01-04", 16], ["A-01-05", 20]] },
    { product: "大白菜", receivedOffset: -9, expiryOffset: 22, allocations: [["A-01-06", 12]] },
    { product: "紅蘿蔔", receivedOffset: -40, expiryOffset: 5, allocations: [["A-02-01", 18]] },
    { product: "紅蘿蔔", receivedOffset: -12, expiryOffset: 30, allocations: [["A-02-02", 20], ["A-02-03", 9]] },
    { product: "白蘿蔔", receivedOffset: -11, expiryOffset: 26, allocations: [["A-02-04", 15]] },
    { product: "馬鈴薯", receivedOffset: -30, expiryOffset: 35, allocations: [["A-02-05", 20], ["A-02-06", 20]] },
    { product: "馬鈴薯", receivedOffset: -8, expiryOffset: 50, allocations: [["A-03-01", 20], ["A-03-02", 11]] },
    { product: "芋頭", receivedOffset: -25, expiryOffset: 33, allocations: [["A-03-03", 14]] },
    { product: "南瓜", receivedOffset: -35, expiryOffset: 40, allocations: [["A-03-04", 17], ["A-03-05", 20]] },
    { product: "冬瓜", receivedOffset: -14, expiryOffset: 24, allocations: [["A-03-06", 10]] },
    { product: "玉米", receivedOffset: -16, expiryOffset: 9, allocations: [["A-04-01", 20], ["A-04-02", 20]] },
    { product: "玉米", receivedOffset: -4, expiryOffset: 21, allocations: [["A-04-03", 13]] },
    { product: "竹筍", receivedOffset: -7, expiryOffset: 6, allocations: [["A-04-04", 8]] },
    { product: "青花菜", receivedOffset: -5, expiryOffset: 8, allocations: [["B-01-01", 16], ["B-01-02", 12]] },
    { product: "花椰菜", receivedOffset: -6, expiryOffset: 7, allocations: [["B-01-03", 14]] },
    { product: "草莓", receivedOffset: -5, expiryOffset: 2, allocations: [["B-01-04", 9]] },
    { product: "草莓", receivedOffset: -10, expiryOffset: -2, allocations: [["B-01-05", 3]] },
    { product: "芒果", receivedOffset: -8, expiryOffset: 6, allocations: [["B-01-06", 15], ["B-02-01", 20]] },
    { product: "鳳梨", receivedOffset: -9, expiryOffset: 10, allocations: [["B-02-02", 18]] },
    { product: "荔枝", receivedOffset: -3, expiryOffset: 4, allocations: [["B-02-03", 11]] },
    { product: "香蕉", receivedOffset: -2, expiryOffset: 5, allocations: [["B-02-04", 12]] },
    { product: "毛豆", receivedOffset: -20, expiryOffset: 15, allocations: [["B-02-05", 20], ["B-02-06", 20]] },
    { product: "毛豆", receivedOffset: -3, expiryOffset: 27, allocations: [["B-03-01", 20], ["B-03-02", 8]] },
    { product: "絲瓜", receivedOffset: -4, expiryOffset: 6, allocations: [["B-03-03", 7]] },
  ];
  const rows = mode === "rich" ? rich : basic;
  for (const r of rows) {
    const productId = db.one<{ id: number }>("SELECT id FROM Product WHERE name = ?", r.product)!.id;
    const allocations = r.allocations.map(([code, quantity]) => ({ locationId: db.one<{ id: number }>("SELECT id FROM Location WHERE code = ?", code)!.id, quantity }));
    inbound(db, { productId, quantity: allocations.reduce((s, a) => s + a.quantity, 0), receivedDate: day(r.receivedOffset), expiryDate: day(r.expiryOffset), note: "示範資料", allocations }, { operator: { id: admin.id } });
  }
}
