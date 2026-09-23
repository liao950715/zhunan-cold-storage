/**
 * 所有改變 Inventory.quantity 的邏輯只在此檔案（AGENTS.md 第 7 條）。
 * 每個操作 = stockMutex 序列化 + 一個 Prisma 互動式交易；任何 AppError 都讓整筆回滾（庫存與異動紀錄同生同滅）。
 */
import type { MovementType } from "@prisma/client";
import { prisma, type Tx } from "../lib/prisma.js";
import { AppError, notFound } from "../lib/errors.js";
import { stockMutex } from "../lib/mutex.js";
import { nextBatchNo } from "../lib/batchNumber.js";
import { formatDate, parseDate } from "../lib/dates.js";

export interface Operator {
  id: number;
}

interface Ctx {
  operator: Operator;
  idempotencyKey?: string;
}

// ---------- 交易內共用工具 ----------

async function loadProduct(tx: Tx, productId: number) {
  const p = await tx.product.findUnique({ where: { id: productId } });
  if (!p) throw notFound("商品");
  if (p.status !== "ACTIVE") throw new AppError("CONFLICT", 409, `商品「${p.name}」已停用，不可再入庫`);
  return p;
}

async function loadLocation(tx: Tx, locationId: number) {
  const loc = await tx.location.findUnique({ where: { id: locationId }, include: { rack: { include: { warehouse: true } } } });
  if (!loc || loc.status !== "ACTIVE") throw notFound("儲位");
  return loc;
}

/** 儲位目前商品與占用量（quantity>0 的列）。 */
async function locationState(tx: Tx, locationId: number) {
  const rows = await tx.inventory.findMany({
    where: { locationId, quantity: { gt: 0 } },
    include: { batch: { select: { productId: true, product: { select: { name: true } } } } },
  });
  const occupied = rows.reduce((s, r) => s + r.quantity, 0);
  const first = rows[0]?.batch;
  return { occupied, currentProductId: first?.productId ?? null, currentProductName: first?.product.name ?? null };
}

async function capacityFor(tx: Tx, locationId: number, productId: number, defaultCapacity: number | null) {
  const cap = await tx.locationCapacity.findUnique({ where: { locationId_productId: { locationId, productId } } });
  return cap?.capacity ?? defaultCapacity ?? null; // null = 不限制（Q2 預設）
}

/**
 * 驗證可把 addQty 個 product 放進儲位（FR-006 單一商品、FR-007 容量）。
 * `pendingAdd`：同一筆操作中已預計放入此儲位的量（多儲位分配同儲位不會發生，但保留彈性）。
 */
async function ensureCanAdd(tx: Tx, locationId: number, product: { id: number; name: string; unit: string }, addQty: number, pendingAdd = 0) {
  const loc = await loadLocation(tx, locationId);
  const state = await locationState(tx, locationId);
  if (state.currentProductId !== null && state.currentProductId !== product.id) {
    throw new AppError(
      "LOCATION_PRODUCT_CONFLICT",
      409,
      `儲位 ${loc.code} 目前存放「${state.currentProductName}」，不可放入不同商品「${product.name}」；請先清空儲位或選擇其他儲位`,
      { locationCode: loc.code, currentProduct: state.currentProductName, requestedProduct: product.name },
    );
  }
  const capacity = await capacityFor(tx, locationId, product.id, loc.defaultCapacity);
  const current = state.occupied + pendingAdd;
  if (capacity !== null && current + addQty > capacity) {
    throw new AppError(
      "CAPACITY_EXCEEDED",
      409,
      `儲位 ${loc.code} 對「${product.name}」容量 ${capacity} ${product.unit}，目前 ${current} ${product.unit}，本次 ${addQty} ${product.unit} 會超過容量`,
      { locationCode: loc.code, capacity, current, requested: addQty },
    );
  }
  return loc;
}

/** 增加庫存（upsert），回傳前後數量。 */
async function addInventory(tx: Tx, batchId: number, locationId: number, qty: number) {
  const existing = await tx.inventory.findUnique({ where: { batchId_locationId: { batchId, locationId } } });
  const before = existing?.quantity ?? 0;
  if (existing) {
    await tx.inventory.update({ where: { id: existing.id }, data: { quantity: { increment: qty } } });
  } else {
    await tx.inventory.create({ data: { batchId, locationId, quantity: qty } });
  }
  return { before, after: before + qty };
}

/** 扣減庫存：條件更新（WHERE quantity >= qty），影響 0 筆即代表不足；歸零則刪除列。 */
async function removeInventory(tx: Tx, batchId: number, locationId: number, qty: number, label: string) {
  const existing = await tx.inventory.findUnique({ where: { batchId_locationId: { batchId, locationId } } });
  const before = existing?.quantity ?? 0;
  const res = await tx.inventory.updateMany({
    where: { batchId, locationId, quantity: { gte: qty } },
    data: { quantity: { decrement: qty } },
  });
  if (res.count !== 1) {
    throw new AppError("INSUFFICIENT_STOCK", 409, `${label} 可用庫存 ${before}，不足以扣除 ${qty}`, { available: before, requested: qty });
  }
  const after = before - qty;
  if (after === 0) await tx.inventory.deleteMany({ where: { batchId, locationId } });
  return { before, after };
}

interface MovementInput {
  type: MovementType;
  productId: number;
  productName: string;
  batchId: number;
  quantity: number;
  from?: { locationId: number; code: string; before: number; after: number };
  to?: { locationId: number; code: string; before: number; after: number };
  reason?: string | null;
  referenceType?: string;
  referenceId?: number;
}

function createMovement(tx: Tx, operatorId: number, m: MovementInput) {
  return tx.stockMovement.create({
    data: {
      type: m.type,
      productId: m.productId,
      batchId: m.batchId,
      quantity: m.quantity,
      fromLocationId: m.from?.locationId,
      fromBeforeQty: m.from?.before,
      fromAfterQty: m.from?.after,
      toLocationId: m.to?.locationId,
      toBeforeQty: m.to?.before,
      toAfterQty: m.to?.after,
      productNameSnapshot: m.productName,
      locationCodeSnapshot: [m.from?.code, m.to?.code].filter(Boolean).join("→"),
      reason: m.reason ?? null,
      referenceType: m.referenceType,
      referenceId: m.referenceId,
      operatorId,
    },
  });
}

/** 序列化 + 交易 + Idempotency-Key（在同一交易內寫入，重複 key 直接回放第一次結果，Q7）。 */
async function runStockTx<T>(ctx: Ctx, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return stockMutex.run(() =>
    prisma.$transaction(
      async (tx) => {
        if (ctx.idempotencyKey) {
          const seen = await tx.idempotencyKey.findUnique({ where: { key: ctx.idempotencyKey } });
          if (seen) {
            if (seen.userId !== ctx.operator.id) throw new AppError("DUPLICATE_REQUEST", 409, "此請求識別碼已被使用");
            return JSON.parse(seen.responseJson) as T;
          }
        }
        const result = await fn(tx);
        if (ctx.idempotencyKey) {
          await tx.idempotencyKey.create({ data: { key: ctx.idempotencyKey, userId: ctx.operator.id, responseJson: JSON.stringify(result) } });
        }
        return result;
      },
      { timeout: 15_000 },
    ),
  );
}

// ---------- 入庫（FR-008～010） ----------

export interface InboundInput {
  productId: number;
  quantity: number;
  expiryDate: string;
  receivedDate?: string;
  note?: string | null;
  allocations: Array<{ locationId: number; quantity: number }>;
}

export function inbound(input: InboundInput, ctx: Ctx) {
  return runStockTx(ctx, async (tx) => {
    const product = await loadProduct(tx, input.productId);
    const sum = input.allocations.reduce((s, a) => s + a.quantity, 0);
    if (sum !== input.quantity) {
      throw new AppError("ALLOCATION_MISMATCH", 409, `分配合計 ${sum} ${product.unit} 不等於入庫量 ${input.quantity} ${product.unit}`, { allocated: sum, quantity: input.quantity });
    }
    const ids = input.allocations.map((a) => a.locationId);
    if (new Set(ids).size !== ids.length) throw new AppError("VALIDATION_ERROR", 400, "同一儲位不可重複分配，請合併數量");

    // 先全部驗證，再寫入：任一儲位失敗即整筆回滾（AT-05 無部分更新）
    const locs: Array<{ code: string }> = [];
    for (const a of input.allocations) locs.push(await ensureCanAdd(tx, a.locationId, product, a.quantity));

    const receivedDate = parseDate(input.receivedDate ?? formatDate(new Date()));
    const batch = await tx.batch.create({
      data: {
        batchNo: await nextBatchNo(tx, receivedDate),
        productId: product.id,
        receivedDate,
        expiryDate: parseDate(input.expiryDate),
        initialQty: input.quantity,
        note: input.note ?? null,
        createdById: ctx.operator.id,
      },
    });

    const movements = [];
    for (const [i, a] of input.allocations.entries()) {
      const { before, after } = await addInventory(tx, batch.id, a.locationId, a.quantity);
      movements.push(
        await createMovement(tx, ctx.operator.id, {
          type: "IN", productId: product.id, productName: product.name, batchId: batch.id, quantity: a.quantity,
          to: { locationId: a.locationId, code: locs[i].code, before, after }, referenceType: "INBOUND", referenceId: batch.id, reason: input.note,
        }),
      );
    }
    return {
      batch: { ...batch, receivedDate: formatDate(batch.receivedDate), expiryDate: formatDate(batch.expiryDate) },
      allocations: input.allocations.map((a, i) => ({ locationId: a.locationId, locationCode: locs[i].code, quantity: a.quantity })),
      movementIds: movements.map((m) => m.id),
    };
  });
}

// ---------- 出庫與 FEFO（FR-011、FR-012） ----------

export async function suggestFefo(productId: number, quantity: number, today = new Date()) {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw notFound("商品");
  const rows = await prisma.inventory.findMany({
    where: { quantity: { gt: 0 }, batch: { productId } },
    include: { batch: true, location: { select: { code: true } } },
    orderBy: [{ batch: { expiryDate: "asc" } }, { batch: { receivedDate: "asc" } }, { location: { code: "asc" } }],
  });
  let remaining = quantity;
  const todayStr = formatDate(today);
  const suggestions = rows.map((r) => {
    const take = Math.min(remaining, r.quantity);
    remaining -= take;
    return {
      batchId: r.batchId,
      batchNo: r.batch.batchNo,
      expiryDate: formatDate(r.batch.expiryDate),
      expired: formatDate(r.batch.expiryDate) < todayStr, // Q6：已過期仍列出並標記
      locationId: r.locationId,
      locationCode: r.location.code,
      available: r.quantity,
      take,
    };
  });
  const available = rows.reduce((s, r) => s + r.quantity, 0);
  return { product: { id: product.id, name: product.name, unit: product.unit }, requested: quantity, available, shortage: Math.max(0, remaining), suggestions };
}

export interface OutboundInput {
  productId: number;
  lines: Array<{ batchId: number; locationId: number; quantity: number }>;
  note?: string | null;
}

export function outbound(input: OutboundInput, ctx: Ctx) {
  return runStockTx(ctx, async (tx) => {
    const product = await tx.product.findUnique({ where: { id: input.productId } });
    if (!product) throw notFound("商品");
    const keys = input.lines.map((l) => `${l.batchId}:${l.locationId}`);
    if (new Set(keys).size !== keys.length) throw new AppError("VALIDATION_ERROR", 400, "同一批次＋儲位不可重複，請合併數量");

    const movements = [];
    for (const line of input.lines) {
      const batch = await tx.batch.findUnique({ where: { id: line.batchId } });
      if (!batch) throw notFound("批次");
      if (batch.productId !== product.id) throw new AppError("VALIDATION_ERROR", 400, `批次 ${batch.batchNo} 不屬於商品「${product.name}」`);
      const loc = await loadLocation(tx, line.locationId);
      const { before, after } = await removeInventory(tx, batch.id, loc.id, line.quantity, `批次 ${batch.batchNo} 於儲位 ${loc.code}`);
      movements.push(
        await createMovement(tx, ctx.operator.id, {
          type: "OUT", productId: product.id, productName: product.name, batchId: batch.id, quantity: line.quantity,
          from: { locationId: loc.id, code: loc.code, before, after }, reason: input.note,
        }),
      );
    }
    const total = input.lines.reduce((s, l) => s + l.quantity, 0);
    return { productId: product.id, total, lines: movements.map((m) => ({ movementId: m.id, batchId: m.batchId, locationId: m.fromLocationId, quantity: m.quantity, before: m.fromBeforeQty, after: m.fromAfterQty })) };
  });
}

// ---------- 搬移（FR-013） ----------

export interface TransferInput {
  batchId: number;
  fromLocationId: number;
  toLocationId: number;
  quantity: number;
  note?: string | null;
}

export function transfer(input: TransferInput, ctx: Ctx) {
  return runStockTx(ctx, async (tx) => {
    if (input.fromLocationId === input.toLocationId) throw new AppError("VALIDATION_ERROR", 400, "來源與目的儲位不可相同");
    const batch = await tx.batch.findUnique({ where: { id: input.batchId }, include: { product: true } });
    if (!batch) throw notFound("批次");
    const from = await loadLocation(tx, input.fromLocationId);
    const to = await ensureCanAdd(tx, input.toLocationId, batch.product, input.quantity);
    const src = await removeInventory(tx, batch.id, from.id, input.quantity, `批次 ${batch.batchNo} 於儲位 ${from.code}`);
    const dst = await addInventory(tx, batch.id, to.id, input.quantity);
    const m = await createMovement(tx, ctx.operator.id, {
      type: "TRANSFER", productId: batch.productId, productName: batch.product.name, batchId: batch.id, quantity: input.quantity,
      from: { locationId: from.id, code: from.code, ...src }, to: { locationId: to.id, code: to.code, ...dst }, reason: input.note,
    });
    return { movementId: m.id, batchNo: batch.batchNo, from: { locationId: from.id, code: from.code, ...src }, to: { locationId: to.id, code: to.code, ...dst } };
  });
}

// ---------- 報損（FR-014） ----------

export interface DamageInput {
  batchId: number;
  locationId: number;
  quantity: number;
  reason: string;
}

export function damage(input: DamageInput, ctx: Ctx) {
  return runStockTx(ctx, async (tx) => {
    const batch = await tx.batch.findUnique({ where: { id: input.batchId }, include: { product: true } });
    if (!batch) throw notFound("批次");
    const loc = await loadLocation(tx, input.locationId);
    const r = await removeInventory(tx, batch.id, loc.id, input.quantity, `批次 ${batch.batchNo} 於儲位 ${loc.code}`);
    const m = await createMovement(tx, ctx.operator.id, {
      type: "DAMAGE", productId: batch.productId, productName: batch.product.name, batchId: batch.id, quantity: input.quantity,
      from: { locationId: loc.id, code: loc.code, ...r }, reason: input.reason,
    });
    return { movementId: m.id, batchNo: batch.batchNo, locationCode: loc.code, ...r };
  });
}

// ---------- 容量設定（FR-007） ----------

export interface CapacityInput {
  defaultCapacity?: number | null;
  items?: Array<{ productId: number; capacity: number }>;
}

/** 修改容量低於目前占用 → 拒絕（Q3 預設）。 */
export function setCapacities(locationId: number, input: CapacityInput, ctx: Ctx) {
  return runStockTx(ctx, async (tx) => {
    const loc = await loadLocation(tx, locationId);
    const state = await locationState(tx, locationId);
    const reject = (productName: string, capacity: number) =>
      new AppError("CAPACITY_BELOW_OCCUPIED", 409, `儲位 ${loc.code} 目前存放「${productName}」${state.occupied}，容量不可設為 ${capacity}；請先搬移或出庫`, { occupied: state.occupied, capacity });

    for (const item of input.items ?? []) {
      const p = await tx.product.findUnique({ where: { id: item.productId } });
      if (!p) throw notFound("商品");
      if (state.currentProductId === p.id && item.capacity < state.occupied) throw reject(p.name, item.capacity);
      await tx.locationCapacity.upsert({
        where: { locationId_productId: { locationId, productId: p.id } },
        create: { locationId, productId: p.id, capacity: item.capacity },
        update: { capacity: item.capacity },
      });
    }
    if (input.defaultCapacity !== undefined) {
      if (input.defaultCapacity !== null && state.currentProductId !== null) {
        const specific = await tx.locationCapacity.findUnique({ where: { locationId_productId: { locationId, productId: state.currentProductId } } });
        if (!specific && input.defaultCapacity < state.occupied) throw reject(state.currentProductName ?? "", input.defaultCapacity);
      }
      await tx.location.update({ where: { id: locationId }, data: { defaultCapacity: input.defaultCapacity } });
    }
    const capacities = await tx.locationCapacity.findMany({ where: { locationId }, include: { product: { select: { name: true } } } });
    const updated = await tx.location.findUniqueOrThrow({ where: { id: locationId } });
    return { locationId, defaultCapacity: updated.defaultCapacity, items: capacities.map((c) => ({ productId: c.productId, productName: c.product.name, capacity: c.capacity })) };
  });
}
