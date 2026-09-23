import { prisma } from "../lib/prisma.js";
import { formatDate } from "../lib/dates.js";

/** FR-017／FR-018：統計依單位分組，不跨單位相加；效期依批次到期日與商品提醒天數；低庫存依商品可用總量。 */
export async function getDashboard(today = new Date()) {
  const [products, rows, locationCount, pendingStocktakes] = await Promise.all([
    prisma.product.findMany({ where: { status: "ACTIVE" } }),
    prisma.inventory.findMany({ where: { quantity: { gt: 0 } }, include: { batch: { include: { product: true } }, location: { select: { id: true, code: true, rack: { select: { warehouse: { select: { code: true } } } } } } } }),
    prisma.location.count({ where: { status: "ACTIVE" } }),
    prisma.stocktake.count({ where: { status: "PENDING" } }),
  ]);

  const todayStr = formatDate(today);
  const byProduct = new Map<number, number>();
  const byUnit = new Map<string, number>();
  const occupiedLocations = new Set<number>();
  const batches = new Set<number>();
  for (const r of rows) {
    byProduct.set(r.batch.productId, (byProduct.get(r.batch.productId) ?? 0) + r.quantity);
    byUnit.set(r.batch.product.unit, (byUnit.get(r.batch.product.unit) ?? 0) + r.quantity);
    occupiedLocations.add(r.locationId);
    batches.add(r.batchId);
  }

  // 效期提醒：以批次為單位彙整各儲位
  const expiryMap = new Map<number, { batchId: number; batchNo: string; product: { id: number; name: string; unit: string }; expiryDate: string; daysLeft: number; expired: boolean; quantity: number; locations: string[] }>();
  for (const r of rows) {
    const exp = formatDate(r.batch.expiryDate);
    const daysLeft = Math.round((r.batch.expiryDate.getTime() - new Date(`${todayStr}T00:00:00Z`).getTime()) / 86_400_000);
    if (daysLeft > r.batch.product.expiryAlertDays) continue;
    const e = expiryMap.get(r.batchId) ?? { batchId: r.batchId, batchNo: r.batch.batchNo, product: { id: r.batch.product.id, name: r.batch.product.name, unit: r.batch.product.unit }, expiryDate: exp, daysLeft, expired: daysLeft < 0, quantity: 0, locations: [] };
    e.quantity += r.quantity;
    e.locations.push(r.location.code);
    expiryMap.set(r.batchId, e);
  }
  const expiryAlerts = [...expiryMap.values()].sort((a, b) => a.daysLeft - b.daysLeft);

  const lowStock = products
    .filter((p) => p.lowStockThreshold > 0 && (byProduct.get(p.id) ?? 0) <= p.lowStockThreshold)
    .map((p) => ({ productId: p.id, name: p.name, unit: p.unit, available: byProduct.get(p.id) ?? 0, threshold: p.lowStockThreshold }))
    .sort((a, b) => a.available / a.threshold - b.available / b.threshold);

  return {
    stats: {
      activeProducts: products.length,
      productsInStock: byProduct.size,
      batchesInStock: batches.size,
      occupiedLocations: occupiedLocations.size,
      totalLocations: locationCount,
      pendingStocktakes,
    },
    totalsByUnit: [...byUnit.entries()].map(([unit, quantity]) => ({ unit, quantity })).sort((a, b) => b.quantity - a.quantity),
    expiryAlerts,
    lowStock,
  };
}
