/**
 * FR-015 盤點：提交只建立待核准單（不改庫存）；核准／退回由 stockService.approveStocktake／rejectStocktake 處理。
 */
import { prisma } from "../lib/prisma.js";
import { AppError, notFound } from "../lib/errors.js";
import { formatDate } from "../lib/dates.js";

export interface StocktakeInput {
  warehouseId?: number;
  note?: string | null;
  items: Array<{ locationId: number; batchId: number; countedQty: number }>;
}

export async function submitStocktake(input: StocktakeInput, operatorId: number) {
  const keys = input.items.map((i) => `${i.locationId}:${i.batchId}`);
  if (new Set(keys).size !== keys.length) throw new AppError("VALIDATION_ERROR", 400, "同一儲位＋批次不可重複盤點");
  return prisma.$transaction(async (tx) => {
    const items = [];
    for (const i of input.items) {
      const loc = await tx.location.findUnique({ where: { id: i.locationId } });
      if (!loc || loc.status !== "ACTIVE") throw notFound("儲位");
      const batch = await tx.batch.findUnique({ where: { id: i.batchId } });
      if (!batch) throw notFound("批次");
      const inv = await tx.inventory.findUnique({ where: { batchId_locationId: { batchId: i.batchId, locationId: i.locationId } } });
      const systemQty = inv?.quantity ?? 0; // 提交當下基準（核准時比對，AT-24）
      items.push({ locationId: i.locationId, batchId: i.batchId, systemQty, countedQty: i.countedQty, diff: i.countedQty - systemQty });
    }
    return tx.stocktake.create({
      data: { warehouseId: input.warehouseId, note: input.note ?? null, submittedById: operatorId, items: { create: items } },
      include: { items: true },
    });
  });
}

const include = {
  items: { include: { location: { select: { code: true } }, batch: { select: { batchNo: true, expiryDate: true, product: { select: { id: true, name: true, unit: true } } } } } },
  submittedBy: { select: { id: true, displayName: true } },
  reviewedBy: { select: { id: true, displayName: true } },
  warehouse: { select: { id: true, code: true, name: true } },
} as const;

function serialize(s: Awaited<ReturnType<typeof prisma.stocktake.findFirstOrThrow<{ include: typeof include }>>>) {
  return {
    ...s,
    items: s.items.map((i) => ({
      id: i.id,
      locationId: i.locationId,
      locationCode: i.location.code,
      batchId: i.batchId,
      batchNo: i.batch.batchNo,
      expiryDate: formatDate(i.batch.expiryDate),
      product: i.batch.product,
      systemQty: i.systemQty,
      countedQty: i.countedQty,
      diff: i.diff,
    })),
  };
}

export async function listStocktakes(status?: "PENDING" | "APPROVED" | "REJECTED") {
  const rows = await prisma.stocktake.findMany({ where: { status }, include, orderBy: { id: "desc" } });
  return { items: rows.map(serialize), total: rows.length };
}

export async function getStocktake(id: number) {
  const s = await prisma.stocktake.findUnique({ where: { id }, include });
  if (!s) throw notFound("盤點單");
  return serialize(s);
}

/** 盤點基準：某冷凍庫（或全部）目前所有 quantity>0 的庫存列，供前端產生盤點表。 */
export async function stocktakeBaseline(warehouseId?: number) {
  const rows = await prisma.inventory.findMany({
    where: { quantity: { gt: 0 }, location: warehouseId ? { rack: { warehouseId } } : undefined },
    include: { batch: { include: { product: { select: { id: true, name: true, unit: true } } } }, location: { select: { id: true, code: true } } },
    orderBy: { location: { code: "asc" } },
  });
  return rows.map((r) => ({ locationId: r.locationId, locationCode: r.location.code, batchId: r.batchId, batchNo: r.batch.batchNo, expiryDate: formatDate(r.batch.expiryDate), product: r.batch.product, systemQty: r.quantity }));
}
