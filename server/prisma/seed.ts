/**
 * 示範種子資料（模擬，不是案例公司真實資料）。
 * `npm run db:seed` 執行 main()；測試透過 seedBase() 建立最小資料。
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

export const DEMO_ACCOUNTS = {
  admin: { username: "admin", password: "admin1234", displayName: "李太太（管理員）", role: "ADMIN" as const },
  staff: { username: "staff", password: "staff1234", displayName: "倉庫工作人員", role: "STAFF" as const },
};

// 約 20 種蔬果；單位、警戒值、提醒天數皆為示意
export const DEMO_PRODUCTS = [
  ["甘藍菜", "葉菜", "籠", 10, 14],
  ["高麗菜", "葉菜", "籠", 10, 14],
  ["大白菜", "葉菜", "籠", 8, 14],
  ["青花菜", "花菜", "箱", 10, 10],
  ["花椰菜", "花菜", "箱", 10, 10],
  ["紅蘿蔔", "根莖", "箱", 15, 30],
  ["白蘿蔔", "根莖", "箱", 10, 30],
  ["馬鈴薯", "根莖", "箱", 20, 45],
  ["芋頭", "根莖", "箱", 5, 45],
  ["毛豆", "豆類", "公斤", 50, 30],
  ["玉米", "穀類", "箱", 10, 20],
  ["竹筍", "筍類", "籠", 5, 10],
  ["南瓜", "瓜果", "箱", 8, 45],
  ["冬瓜", "瓜果", "箱", 5, 30],
  ["絲瓜", "瓜果", "箱", 5, 10],
  ["草莓", "水果", "箱", 10, 7],
  ["芒果", "水果", "箱", 10, 10],
  ["鳳梨", "水果", "箱", 10, 14],
  ["荔枝", "水果", "箱", 8, 7],
  ["香蕉", "水果", "箱", 10, 7],
] as const;

/** 最小資料：兩個帳號、兩座冷凍庫、貨架與儲位、全部商品。可重複執行（upsert）。 */
export async function seedBase(prisma: PrismaClient) {
  for (const a of Object.values(DEMO_ACCOUNTS)) {
    await prisma.user.upsert({
      where: { username: a.username },
      update: {},
      create: { username: a.username, passwordHash: await bcrypt.hash(a.password, 10), displayName: a.displayName, role: a.role },
    });
  }

  const layoutA = { entrance: { x: 0, y: 340, width: 40, height: 120 }, aisles: [{ x: 40, y: 340, width: 1160, height: 120 }] };
  const layoutB = { entrance: { x: 0, y: 340, width: 40, height: 120 }, aisles: [{ x: 40, y: 340, width: 1160, height: 120 }] };
  const warehouses = [
    { code: "A", name: "冷凍庫 A", width: 1200, height: 800, layoutJson: JSON.stringify(layoutA), rackCount: 4 },
    { code: "B", name: "冷凍庫 B", width: 1200, height: 800, layoutJson: JSON.stringify(layoutB), rackCount: 3 },
  ];
  for (const w of warehouses) {
    const { rackCount, ...data } = w;
    const wh = await prisma.warehouse.upsert({ where: { code: w.code }, update: {}, create: data });
    for (let r = 1; r <= rackCount; r++) {
      const rackCode = String(r).padStart(2, "0");
      // 貨架 1200 寬、各 240 寬；上排（y=80）與下排（y=500）
      const x = 80 + ((r - 1) % 2) * 560;
      const y = r <= 2 ? 80 : 500;
      const rack = await prisma.rack.upsert({
        where: { warehouseId_code: { warehouseId: wh.id, code: rackCode } },
        update: {},
        create: { warehouseId: wh.id, code: rackCode, label: `貨架 ${rackCode}`, x, y, width: 480, height: 200 },
      });
      for (let l = 1; l <= 6; l++) {
        const code = `${w.code}-${rackCode}-${String(l).padStart(2, "0")}`;
        await prisma.location.upsert({
          where: { code },
          update: {},
          create: { rackId: rack.id, code, x: ((l - 1) % 3) * 160, y: l <= 3 ? 0 : 100, width: 160, height: 100, defaultCapacity: 20 },
        });
      }
    }
  }

  for (const [name, category, unit, low, days] of DEMO_PRODUCTS) {
    await prisma.product.upsert({
      where: { name },
      update: {},
      create: { name, category, unit, lowStockThreshold: low, expiryAlertDays: days },
    });
  }
}

/**
 * 展示用初始庫存：透過正式入庫服務（stockService.inbound）產生，遵守全部業務規則。
 * 只在尚無任何批次時執行（避免重複 seed 疊加庫存）。
 */
export async function seedDemoStock(prisma: PrismaClient) {
  if ((await prisma.batch.count()) > 0) return;
  const { inbound } = await import("../src/services/stockService.js");
  const admin = await prisma.user.findUniqueOrThrow({ where: { username: "admin" } });
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  const rows: Array<{ product: string; receivedOffset: number; expiryOffset: number; allocations: Array<[string, number]> }> = [
    { product: "紅蘿蔔", receivedOffset: -22, expiryOffset: 20, allocations: [["A-01-01", 12], ["A-01-02", 8]] },
    { product: "馬鈴薯", receivedOffset: -18, expiryOffset: 40, allocations: [["A-02-01", 18]] },
    { product: "草莓", receivedOffset: -3, expiryOffset: 3, allocations: [["B-01-01", 6]] }, // 即將到期
    { product: "毛豆", receivedOffset: -13, expiryOffset: 25, allocations: [["B-02-01", 15]] },
  ];
  for (const r of rows) {
    const product = await prisma.product.findUniqueOrThrow({ where: { name: r.product } });
    const allocations = [];
    for (const [code, quantity] of r.allocations) {
      const loc = await prisma.location.findUniqueOrThrow({ where: { code } });
      allocations.push({ locationId: loc.id, quantity });
    }
    await inbound(
      {
        productId: product.id,
        quantity: allocations.reduce((s, a) => s + a.quantity, 0),
        receivedDate: day(r.receivedOffset),
        expiryDate: day(r.expiryOffset),
        note: "示範資料",
        allocations,
      },
      { operator: { id: admin.id } },
    );
  }
}

async function main() {
  const prisma = new PrismaClient();
  try {
    await seedBase(prisma);
    await seedDemoStock(prisma);
    console.log("seed 完成：帳號 admin/admin1234、staff/staff1234（僅供展示）");
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && /seed\.ts$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
