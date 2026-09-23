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

/** 展示用初始庫存：少量既有批次（含一筆即將到期）以呈現 Dashboard 提醒。Stage 2 完成 stockService 後改由入庫 API 產生。 */
export async function seedDemoStock(prisma: PrismaClient) {
  const admin = await prisma.user.findUniqueOrThrow({ where: { username: "admin" } });
  const day = (offset: number) => new Date(Date.UTC(2026, 8, 23 + offset));
  const rows: Array<[string, string, string, number, number]> = [
    // 商品, 儲位, 批次號, 到期日偏移(天), 數量
    ["紅蘿蔔", "A-01-01", "B20260901-001", 20, 12],
    ["紅蘿蔔", "A-01-02", "B20260901-001", 20, 8],
    ["馬鈴薯", "A-02-01", "B20260905-001", 40, 18],
    ["草莓", "B-01-01", "B20260920-001", 3, 6], // 即將到期
    ["毛豆", "B-02-01", "B20260910-001", 25, 15],
  ];
  for (const [productName, locationCode, batchNo, expOffset, qty] of rows) {
    const product = await prisma.product.findUniqueOrThrow({ where: { name: productName } });
    const location = await prisma.location.findUniqueOrThrow({ where: { code: locationCode } });
    const batch = await prisma.batch.upsert({
      where: { batchNo },
      update: {},
      create: { batchNo, productId: product.id, receivedDate: day(-15), expiryDate: day(expOffset), initialQty: qty, createdById: admin.id },
    });
    await prisma.inventory.upsert({
      where: { batchId_locationId: { batchId: batch.id, locationId: location.id } },
      update: {},
      create: { batchId: batch.id, locationId: location.id, quantity: qty },
    });
    const existing = await prisma.stockMovement.findFirst({ where: { batchId: batch.id, toLocationId: location.id, type: "IN" } });
    if (!existing) {
      await prisma.stockMovement.create({
        data: {
          type: "IN", productId: product.id, batchId: batch.id, toLocationId: location.id, quantity: qty,
          toBeforeQty: 0, toAfterQty: qty, productNameSnapshot: product.name, locationCodeSnapshot: location.code,
          referenceType: "SEED", operatorId: admin.id,
        },
      });
    }
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
