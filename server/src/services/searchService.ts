import { prisma } from "../lib/prisma.js";
import { toStockLine } from "./stockQueryService.js";

/**
 * FR-019：依商品名稱、批次編號、儲位編號搜尋，回傳所有匹配的批次、數量與位置。
 * 只回傳 quantity > 0 的庫存列；另附商品命中清單（含零庫存商品，方便入庫流程選商品）。
 */
export async function search(q: string) {
  const term = q.trim();
  if (!term) return { query: term, products: [], lines: [] };
  const [products, rows] = await Promise.all([
    prisma.product.findMany({ where: { name: { contains: term }, status: "ACTIVE" }, orderBy: { name: "asc" } }),
    prisma.inventory.findMany({
      where: {
        quantity: { gt: 0 },
        OR: [
          { batch: { product: { name: { contains: term } } } },
          { batch: { batchNo: { contains: term } } },
          { location: { code: { contains: term } } },
        ],
      },
      include: {
        batch: { include: { product: true } },
        location: { include: { rack: { include: { warehouse: true } } } },
      },
      orderBy: [{ batch: { expiryDate: "asc" } }, { location: { code: "asc" } }],
    }),
  ]);
  return {
    query: term,
    products: products.map((p) => ({ id: p.id, name: p.name, unit: p.unit, category: p.category })),
    lines: rows.map(toStockLine),
  };
}
