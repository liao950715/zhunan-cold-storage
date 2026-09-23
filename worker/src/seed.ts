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

/** 展示用初始庫存：走正式入庫服務，遵守全部規則；只在尚無批次時執行。 */
export function seedDemoStock(db: Db) {
  if (db.one<{ n: number }>("SELECT COUNT(*) AS n FROM Batch")!.n > 0) return;
  const admin = db.one<{ id: number }>("SELECT id FROM User WHERE username = 'admin'")!;
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  const rows: Array<{ product: string; receivedOffset: number; expiryOffset: number; allocations: Array<[string, number]> }> = [
    { product: "紅蘿蔔", receivedOffset: -22, expiryOffset: 20, allocations: [["A-01-01", 12], ["A-01-02", 8]] },
    { product: "馬鈴薯", receivedOffset: -18, expiryOffset: 40, allocations: [["A-02-01", 18]] },
    { product: "草莓", receivedOffset: -3, expiryOffset: 3, allocations: [["B-01-01", 6]] },
    { product: "毛豆", receivedOffset: -13, expiryOffset: 25, allocations: [["B-02-01", 15]] },
  ];
  for (const r of rows) {
    const productId = db.one<{ id: number }>("SELECT id FROM Product WHERE name = ?", r.product)!.id;
    const allocations = r.allocations.map(([code, quantity]) => ({ locationId: db.one<{ id: number }>("SELECT id FROM Location WHERE code = ?", code)!.id, quantity }));
    inbound(db, { productId, quantity: allocations.reduce((s, a) => s + a.quantity, 0), receivedDate: day(r.receivedOffset), expiryDate: day(r.expiryOffset), note: "示範資料", allocations }, { operator: { id: admin.id } });
  }
}
