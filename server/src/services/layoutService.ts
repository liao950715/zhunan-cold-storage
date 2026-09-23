/**
 * FR-005 布局編輯：儲存貨架／儲位幾何、新增、軟刪除。
 * 只動 Rack／Location／Warehouse 的幾何欄位，絕不觸碰 Inventory／StockMovement（AT-16）。
 */
import { prisma, type Tx } from "../lib/prisma.js";
import { AppError, notFound } from "../lib/errors.js";

export interface LocationInput {
  id?: number;
  code: string;
  x: number;
  y: number;
  width: number;
  height: number;
  defaultCapacity?: number | null;
}

export interface RackInput {
  id?: number;
  code: string;
  label?: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  locations: LocationInput[];
}

export interface LayoutInput {
  version: number;
  width?: number;
  height?: number;
  layout?: Record<string, unknown>;
  racks: RackInput[];
}

const inside = (inner: { x: number; y: number; width: number; height: number }, outerW: number, outerH: number) =>
  inner.x >= 0 && inner.y >= 0 && inner.x + inner.width <= outerW && inner.y + inner.height <= outerH;

/** 越界拒絕；重疊只在前端警告（Q4）。 */
function validateGeometry(input: LayoutInput, width: number, height: number) {
  const rackCodes = new Set<string>();
  const locCodes = new Set<string>();
  for (const r of input.racks) {
    if (rackCodes.has(r.code)) throw new AppError("VALIDATION_ERROR", 400, `貨架代碼「${r.code}」重複`);
    rackCodes.add(r.code);
    if (!inside(r, width, height)) throw new AppError("VALIDATION_ERROR", 400, `貨架「${r.code}」超出冷凍庫範圍（${width}×${height}）`, { rack: r.code });
    for (const l of r.locations) {
      if (locCodes.has(l.code)) throw new AppError("VALIDATION_ERROR", 400, `儲位代碼「${l.code}」重複`);
      locCodes.add(l.code);
      if (!inside(l, r.width, r.height)) throw new AppError("VALIDATION_ERROR", 400, `儲位「${l.code}」超出貨架「${r.code}」範圍`, { location: l.code });
    }
  }
}

export async function saveLayout(warehouseId: number, input: LayoutInput) {
  return prisma.$transaction(async (tx) => {
    const wh = await tx.warehouse.findUnique({ where: { id: warehouseId } });
    if (!wh) throw notFound("冷凍庫");
    if (wh.layoutVersion !== input.version) {
      throw new AppError("CONCURRENT_UPDATE", 409, "布局已被其他人修改，請重新整理後再編輯", { current: wh.layoutVersion, submitted: input.version });
    }
    const width = input.width ?? wh.width;
    const height = input.height ?? wh.height;
    validateGeometry(input, width, height);

    // 既有貨架／儲位必須屬於本冷凍庫且未封存
    const existingRacks = await tx.rack.findMany({ where: { warehouseId, status: "ACTIVE" }, include: { locations: { where: { status: "ACTIVE" } } } });
    const rackById = new Map(existingRacks.map((r) => [r.id, r]));

    for (const r of input.racks) {
      let rackId: number;
      const geom = { code: r.code, label: r.label ?? null, x: r.x, y: r.y, width: r.width, height: r.height, rotation: r.rotation ?? 0 };
      if (r.id !== undefined) {
        const existing = rackById.get(r.id);
        if (!existing) throw new AppError("VALIDATION_ERROR", 400, `貨架 id ${r.id} 不屬於此冷凍庫`);
        await tx.rack.update({ where: { id: r.id }, data: geom });
        rackId = r.id;
      } else {
        await ensureCodeFree(tx, "rack", warehouseId, r.code);
        rackId = (await tx.rack.create({ data: { warehouseId, ...geom } })).id;
      }
      const locIds = new Set((rackById.get(rackId)?.locations ?? []).map((l) => l.id));
      for (const l of r.locations) {
        const lg = { code: l.code, x: l.x, y: l.y, width: l.width, height: l.height, defaultCapacity: l.defaultCapacity ?? null };
        if (l.id !== undefined) {
          if (!locIds.has(l.id)) throw new AppError("VALIDATION_ERROR", 400, `儲位 id ${l.id} 不屬於貨架「${r.code}」（儲位不可跨貨架移動，請用搬移處理庫存）`);
          await tx.location.update({ where: { id: l.id }, data: lg });
        } else {
          await ensureCodeFree(tx, "location", warehouseId, l.code);
          await tx.location.create({ data: { rackId, ...lg } });
        }
      }
    }
    return tx.warehouse.update({
      where: { id: warehouseId },
      data: { width, height, layoutJson: input.layout ? JSON.stringify(input.layout) : undefined, layoutVersion: { increment: 1 } },
      select: { id: true, layoutVersion: true },
    });
  });
}

async function ensureCodeFree(tx: Tx, kind: "rack" | "location", warehouseId: number, code: string) {
  const dup =
    kind === "rack"
      ? await tx.rack.findUnique({ where: { warehouseId_code: { warehouseId, code } } })
      : await tx.location.findUnique({ where: { code } });
  if (dup) throw new AppError("CONFLICT", 409, `${kind === "rack" ? "貨架" : "儲位"}代碼「${code}」已存在（含已封存）`);
}

/** 有庫存儲位不可刪除（AT-17）；軟刪除保留歷史。 */
export async function deleteLocation(locationId: number) {
  return prisma.$transaction(async (tx) => {
    const loc = await tx.location.findUnique({ where: { id: locationId }, include: { rack: true } });
    if (!loc || loc.status !== "ACTIVE") throw notFound("儲位");
    const qty = (await tx.inventory.aggregate({ _sum: { quantity: true }, where: { locationId } }))._sum.quantity ?? 0;
    if (qty > 0) throw new AppError("LOCATION_NOT_EMPTY", 409, `儲位 ${loc.code} 尚有庫存 ${qty}，請先出庫或搬移後再刪除`, { locationCode: loc.code, quantity: qty });
    await tx.location.update({ where: { id: locationId }, data: { status: "ARCHIVED" } });
    await tx.warehouse.update({ where: { id: loc.rack.warehouseId }, data: { layoutVersion: { increment: 1 } } });
    return { id: locationId, code: loc.code };
  });
}

/** 貨架下任一儲位有庫存即拒絕；否則貨架與其儲位一併軟刪除（Q5）。 */
export async function deleteRack(rackId: number) {
  return prisma.$transaction(async (tx) => {
    const rack = await tx.rack.findUnique({ where: { id: rackId }, include: { locations: { where: { status: "ACTIVE" } } } });
    if (!rack || rack.status !== "ACTIVE") throw notFound("貨架");
    const ids = rack.locations.map((l) => l.id);
    const stocked = await tx.inventory.groupBy({ by: ["locationId"], where: { locationId: { in: ids }, quantity: { gt: 0 } }, _sum: { quantity: true } });
    if (stocked.length > 0) {
      const codes = rack.locations.filter((l) => stocked.some((s) => s.locationId === l.id)).map((l) => l.code);
      throw new AppError("LOCATION_NOT_EMPTY", 409, `貨架 ${rack.code} 的儲位 ${codes.join("、")} 尚有庫存，請先清空後再刪除`, { locations: codes });
    }
    await tx.location.updateMany({ where: { rackId }, data: { status: "ARCHIVED" } });
    await tx.rack.update({ where: { id: rackId }, data: { status: "ARCHIVED" } });
    await tx.warehouse.update({ where: { id: rack.warehouseId }, data: { layoutVersion: { increment: 1 } } });
    return { id: rackId, code: rack.code, archivedLocations: ids.length };
  });
}
