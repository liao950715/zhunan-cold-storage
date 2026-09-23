import { prisma } from "../lib/prisma.js";
import { notFound } from "../lib/errors.js";
import { formatDate } from "../lib/dates.js";

const inventoryInclude = {
  batch: { include: { product: true } },
  location: { include: { rack: { include: { warehouse: true } } } },
} as const;

type InvRow = Awaited<ReturnType<typeof prisma.inventory.findFirst<{ include: typeof inventoryInclude }>>>;

/** 統一的庫存明細列格式（搜尋、商品庫存、儲位詳情共用）。 */
export function toStockLine(inv: NonNullable<InvRow>) {
  return {
    inventoryId: inv.id,
    quantity: inv.quantity,
    product: { id: inv.batch.product.id, name: inv.batch.product.name, unit: inv.batch.product.unit },
    batch: {
      id: inv.batch.id,
      batchNo: inv.batch.batchNo,
      receivedDate: formatDate(inv.batch.receivedDate),
      expiryDate: formatDate(inv.batch.expiryDate),
    },
    location: {
      id: inv.location.id,
      code: inv.location.code,
      rackId: inv.location.rackId,
      rackCode: inv.location.rack.code,
      warehouseId: inv.location.rack.warehouseId,
      warehouseCode: inv.location.rack.warehouse.code,
      warehouseName: inv.location.rack.warehouse.name,
    },
  };
}

/** 商品可用總量、各批次、各儲位明細（FR-002/003 查詢）。 */
export async function getProductStock(productId: number) {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw notFound("商品");
  const rows = await prisma.inventory.findMany({
    where: { quantity: { gt: 0 }, batch: { productId } },
    include: inventoryInclude,
    orderBy: [{ batch: { expiryDate: "asc" } }, { location: { code: "asc" } }],
  });
  const lines = rows.map(toStockLine);
  const total = lines.reduce((s, l) => s + l.quantity, 0);
  const byBatch = new Map<number, { batch: (typeof lines)[number]["batch"]; quantity: number; locations: number }>();
  for (const l of lines) {
    const b = byBatch.get(l.batch.id) ?? { batch: l.batch, quantity: 0, locations: 0 };
    b.quantity += l.quantity;
    b.locations += 1;
    byBatch.set(l.batch.id, b);
  }
  return { product, total, batches: [...byBatch.values()], lines };
}

/** 儲位詳情：目前商品（唯一）、各批次數量、容量。 */
export async function getLocationDetail(locationId: number) {
  const location = await prisma.location.findUnique({
    where: { id: locationId },
    include: { rack: { include: { warehouse: true } }, capacities: { include: { product: true } } },
  });
  if (!location) throw notFound("儲位");
  const rows = await prisma.inventory.findMany({
    where: { locationId, quantity: { gt: 0 } },
    include: inventoryInclude,
    orderBy: { batch: { expiryDate: "asc" } },
  });
  const lines = rows.map(toStockLine);
  const currentProduct = lines[0]?.product ?? null;
  const occupied = lines.reduce((s, l) => s + l.quantity, 0);
  return {
    location: {
      id: location.id,
      code: location.code,
      status: location.status,
      defaultCapacity: location.defaultCapacity,
      rackId: location.rackId,
      rackCode: location.rack.code,
      warehouseId: location.rack.warehouseId,
      warehouseCode: location.rack.warehouse.code,
    },
    currentProduct,
    occupied,
    capacities: location.capacities.map((c) => ({ productId: c.productId, productName: c.product.name, capacity: c.capacity })),
    lines,
  };
}
