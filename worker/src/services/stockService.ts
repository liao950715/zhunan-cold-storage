/**
 * 所有改變 Inventory.quantity 的邏輯只在此檔案（AGENTS.md 第 7 條）。
 * Durable Object 單執行緒 ＝ 天然序列化；每個操作包在 db.tx（transactionSync）內，任何 AppError 都整筆回滾。
 */
import type { Db } from "../lib/sql.js";
import { AppError, notFound, validation } from "../lib/errors.js";
import { nextBatchNo } from "../lib/batchNumber.js";
import { todayString } from "../lib/dates.js";

export interface Ctx {
  operator: { id: number };
  idempotencyKey?: string;
}
type MovementType = "IN" | "OUT" | "TRANSFER" | "DAMAGE" | "ADJUSTMENT";
interface ProductRow { id: number; name: string; unit: string; status: string }
interface LocationRow { id: number; code: string; defaultCapacity: number | null; status: string; warehouseId: number; warehouseCode: string }

// ---------- 交易內共用工具 ----------

function loadProduct(db: Db, productId: number) {
  const p = db.one<ProductRow>("SELECT id, name, unit, status FROM Product WHERE id = ?", productId);
  if (!p) throw notFound("商品");
  if (p.status !== "ACTIVE") throw new AppError("CONFLICT", 409, `商品「${p.name}」已停用，不可再入庫`);
  return p;
}

export function loadLocation(db: Db, locationId: number) {
  const loc = db.one<LocationRow>(
    "SELECT l.id, l.code, l.defaultCapacity, l.status, r.warehouseId, w.code AS warehouseCode FROM Location l JOIN Rack r ON r.id = l.rackId JOIN Warehouse w ON w.id = r.warehouseId WHERE l.id = ?",
    locationId,
  );
  if (!loc || loc.status !== "ACTIVE") throw notFound("儲位");
  return loc;
}

/** 儲位目前商品與占用量（quantity>0 的列）。 */
export function locationState(db: Db, locationId: number) {
  const rows = db.all<{ quantity: number; productId: number; productName: string }>(
    "SELECT i.quantity, b.productId, p.name AS productName FROM Inventory i JOIN Batch b ON b.id = i.batchId JOIN Product p ON p.id = b.productId WHERE i.locationId = ? AND i.quantity > 0",
    locationId,
  );
  const occupied = rows.reduce((s, r) => s + r.quantity, 0);
  return { occupied, currentProductId: rows[0]?.productId ?? null, currentProductName: rows[0]?.productName ?? null };
}

function capacityFor(db: Db, locationId: number, productId: number, defaultCapacity: number | null) {
  const cap = db.one<{ capacity: number }>("SELECT capacity FROM LocationCapacity WHERE locationId = ? AND productId = ?", locationId, productId);
  return cap?.capacity ?? defaultCapacity ?? null; // null = 不限制（Q2 預設）
}

/** 驗證可把 addQty 個 product 放進儲位（FR-006 單一商品、FR-007 容量）。 */
function ensureCanAdd(db: Db, locationId: number, product: { id: number; name: string; unit: string }, addQty: number) {
  const loc = loadLocation(db, locationId);
  const state = locationState(db, locationId);
  if (state.currentProductId !== null && state.currentProductId !== product.id) {
    throw new AppError("LOCATION_PRODUCT_CONFLICT", 409,
      `無法放入：儲位 ${loc.code} 目前存放「${state.currentProductName}」，不可放入不同商品「${product.name}」。請先清空儲位或選擇其他儲位。`,
      { locationCode: loc.code, currentProduct: state.currentProductName, requestedProduct: product.name });
  }
  const capacity = capacityFor(db, locationId, product.id, loc.defaultCapacity);
  if (capacity !== null && state.occupied + addQty > capacity) {
    const room = Math.max(0, capacity - state.occupied);
    throw new AppError("CAPACITY_EXCEEDED", 409,
      `無法放入：儲位 ${loc.code} 最多還能放 ${room} ${product.unit}「${product.name}」（容量 ${capacity}，目前 ${state.occupied}），本次 ${addQty} ${product.unit} 會超過。請減少數量或選擇其他儲位。`,
      { locationCode: loc.code, capacity, current: state.occupied, requested: addQty, room });
  }
  return loc;
}

function addInventory(db: Db, batchId: number, locationId: number, qty: number) {
  const before = db.one<{ quantity: number }>("SELECT quantity FROM Inventory WHERE batchId = ? AND locationId = ?", batchId, locationId)?.quantity ?? 0;
  db.run("INSERT INTO Inventory (batchId, locationId, quantity) VALUES (?, ?, ?) ON CONFLICT(batchId, locationId) DO UPDATE SET quantity = quantity + excluded.quantity", batchId, locationId, qty);
  return { before, after: before + qty };
}

/** 扣減：條件更新（WHERE quantity >= qty），影響 0 筆即不足；歸零則刪除列。 */
function removeInventory(db: Db, batchId: number, locationId: number, qty: number, label: string) {
  const before = db.one<{ quantity: number }>("SELECT quantity FROM Inventory WHERE batchId = ? AND locationId = ?", batchId, locationId)?.quantity ?? 0;
  const n = db.run("UPDATE Inventory SET quantity = quantity - ? WHERE batchId = ? AND locationId = ? AND quantity >= ?", qty, batchId, locationId, qty);
  if (n !== 1) throw new AppError("INSUFFICIENT_STOCK", 409, `無法扣除：${label} 可用庫存只有 ${before}，不足以扣除 ${qty}。請減少數量。`, { available: before, requested: qty });
  const after = before - qty;
  if (after === 0) db.run("DELETE FROM Inventory WHERE batchId = ? AND locationId = ?", batchId, locationId);
  return { before, after };
}

interface MovementInput {
  type: MovementType; productId: number; productName: string; batchId: number; quantity: number;
  from?: { locationId: number; code: string; before: number; after: number };
  to?: { locationId: number; code: string; before: number; after: number };
  reason?: string | null; referenceType?: string; referenceId?: number;
}

function createMovement(db: Db, operatorId: number, m: MovementInput) {
  return db.insert(
    `INSERT INTO StockMovement (type, productId, batchId, quantity, fromLocationId, fromBeforeQty, fromAfterQty, toLocationId, toBeforeQty, toAfterQty, productNameSnapshot, locationCodeSnapshot, reason, referenceType, referenceId, operatorId)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    m.type, m.productId, m.batchId, m.quantity,
    m.from?.locationId ?? null, m.from?.before ?? null, m.from?.after ?? null,
    m.to?.locationId ?? null, m.to?.before ?? null, m.to?.after ?? null,
    m.productName, [m.from?.code, m.to?.code].filter(Boolean).join("→"), m.reason ?? null, m.referenceType ?? null, m.referenceId ?? null, operatorId,
  );
}

/** 交易 + Idempotency-Key（同一交易內寫入；重複 key 回放第一次結果，Q7）。 */
function runStockTx<T>(db: Db, ctx: Ctx, fn: () => T): T {
  return db.tx(() => {
    if (ctx.idempotencyKey) {
      const seen = db.one<{ userId: number; responseJson: string }>("SELECT userId, responseJson FROM IdempotencyKey WHERE key = ?", ctx.idempotencyKey);
      if (seen) {
        if (seen.userId !== ctx.operator.id) throw new AppError("DUPLICATE_REQUEST", 409, "此請求識別碼已被使用");
        return JSON.parse(seen.responseJson) as T;
      }
    }
    const result = fn();
    if (ctx.idempotencyKey) db.run("INSERT INTO IdempotencyKey (key, userId, responseJson) VALUES (?, ?, ?)", ctx.idempotencyKey, ctx.operator.id, JSON.stringify(result));
    return result;
  });
}

// ---------- 入庫（FR-008～010） ----------

export interface InboundInput {
  productId: number; quantity: number; expiryDate: string; receivedDate?: string; note?: string | null;
  allocations: Array<{ locationId: number; quantity: number }>;
}

export function inbound(db: Db, input: InboundInput, ctx: Ctx) {
  return runStockTx(db, ctx, () => {
    const product = loadProduct(db, input.productId);
    const sum = input.allocations.reduce((s, a) => s + a.quantity, 0);
    if (sum !== input.quantity) {
      throw new AppError("ALLOCATION_MISMATCH", 409, `無法入庫：分配合計 ${sum} ${product.unit} 不等於入庫量 ${input.quantity} ${product.unit}。請調整各儲位數量。`, { allocated: sum, quantity: input.quantity });
    }
    const ids = input.allocations.map((a) => a.locationId);
    if (new Set(ids).size !== ids.length) throw validation("同一儲位不可重複分配，請合併數量");

    // 先全部驗證，再寫入（AT-05 無部分更新）
    const locs = input.allocations.map((a) => ensureCanAdd(db, a.locationId, product, a.quantity));
    const receivedDate = input.receivedDate ?? todayString();
    const batchNo = nextBatchNo(db, receivedDate);
    const batchId = db.insert("INSERT INTO Batch (batchNo, productId, receivedDate, expiryDate, initialQty, note, createdById) VALUES (?, ?, ?, ?, ?, ?, ?)", batchNo, product.id, receivedDate, input.expiryDate, input.quantity, input.note ?? null, ctx.operator.id);

    const movementIds = input.allocations.map((a, i) => {
      const { before, after } = addInventory(db, batchId, a.locationId, a.quantity);
      return createMovement(db, ctx.operator.id, { type: "IN", productId: product.id, productName: product.name, batchId, quantity: a.quantity, to: { locationId: a.locationId, code: locs[i].code, before, after }, referenceType: "INBOUND", referenceId: batchId, reason: input.note });
    });
    return {
      batch: { id: batchId, batchNo, productId: product.id, receivedDate, expiryDate: input.expiryDate, initialQty: input.quantity, note: input.note ?? null },
      allocations: input.allocations.map((a, i) => ({ locationId: a.locationId, locationCode: locs[i].code, quantity: a.quantity })),
      movementIds,
    };
  });
}

// ---------- 出庫與 FEFO（FR-011、FR-012） ----------

export function suggestFefo(db: Db, productId: number, quantity: number, today = todayString()) {
  const product = db.one<ProductRow>("SELECT id, name, unit, status FROM Product WHERE id = ?", productId);
  if (!product) throw notFound("商品");
  const rows = db.all<{ batchId: number; batchNo: string; expiryDate: string; locationId: number; locationCode: string; quantity: number }>(
    `SELECT i.batchId, b.batchNo, b.expiryDate, i.locationId, l.code AS locationCode, i.quantity
     FROM Inventory i JOIN Batch b ON b.id = i.batchId JOIN Location l ON l.id = i.locationId
     WHERE i.quantity > 0 AND b.productId = ? ORDER BY b.expiryDate, b.receivedDate, l.code`, productId);
  let remaining = quantity;
  const suggestions = rows.map((r) => {
    const take = Math.min(remaining, r.quantity);
    remaining -= take;
    return { batchId: r.batchId, batchNo: r.batchNo, expiryDate: r.expiryDate, expired: r.expiryDate < today, locationId: r.locationId, locationCode: r.locationCode, available: r.quantity, take };
  });
  const available = rows.reduce((s, r) => s + r.quantity, 0);
  return { product: { id: product.id, name: product.name, unit: product.unit }, requested: quantity, available, shortage: Math.max(0, remaining), suggestions };
}

export interface OutboundInput { productId: number; lines: Array<{ batchId: number; locationId: number; quantity: number }>; note?: string | null }

export function outbound(db: Db, input: OutboundInput, ctx: Ctx) {
  return runStockTx(db, ctx, () => {
    const product = db.one<ProductRow>("SELECT id, name, unit, status FROM Product WHERE id = ?", input.productId);
    if (!product) throw notFound("商品");
    const keys = input.lines.map((l) => `${l.batchId}:${l.locationId}`);
    if (new Set(keys).size !== keys.length) throw validation("同一批次＋儲位不可重複，請合併數量");
    const lines = input.lines.map((line) => {
      const batch = db.one<{ id: number; batchNo: string; productId: number }>("SELECT id, batchNo, productId FROM Batch WHERE id = ?", line.batchId);
      if (!batch) throw notFound("批次");
      if (batch.productId !== product.id) throw validation(`批次 ${batch.batchNo} 不屬於商品「${product.name}」`);
      const loc = loadLocation(db, line.locationId);
      const { before, after } = removeInventory(db, batch.id, loc.id, line.quantity, `批次 ${batch.batchNo} 於儲位 ${loc.code}`);
      const movementId = createMovement(db, ctx.operator.id, { type: "OUT", productId: product.id, productName: product.name, batchId: batch.id, quantity: line.quantity, from: { locationId: loc.id, code: loc.code, before, after }, reason: input.note });
      return { movementId, batchId: batch.id, locationId: loc.id, quantity: line.quantity, before, after };
    });
    return { productId: product.id, total: lines.reduce((s, l) => s + l.quantity, 0), lines };
  });
}

// ---------- 搬移（FR-013） ----------

export interface TransferInput { batchId: number; fromLocationId: number; toLocationId: number; quantity: number; note?: string | null }

export function transfer(db: Db, input: TransferInput, ctx: Ctx) {
  return runStockTx(db, ctx, () => {
    if (input.fromLocationId === input.toLocationId) throw validation("來源與目的儲位不可相同");
    const batch = db.one<{ id: number; batchNo: string; productId: number; name: string; unit: string }>("SELECT b.id, b.batchNo, b.productId, p.name, p.unit FROM Batch b JOIN Product p ON p.id = b.productId WHERE b.id = ?", input.batchId);
    if (!batch) throw notFound("批次");
    const from = loadLocation(db, input.fromLocationId);
    const to = ensureCanAdd(db, input.toLocationId, { id: batch.productId, name: batch.name, unit: batch.unit }, input.quantity);
    const src = removeInventory(db, batch.id, from.id, input.quantity, `批次 ${batch.batchNo} 於儲位 ${from.code}`);
    const dst = addInventory(db, batch.id, to.id, input.quantity);
    const movementId = createMovement(db, ctx.operator.id, { type: "TRANSFER", productId: batch.productId, productName: batch.name, batchId: batch.id, quantity: input.quantity, from: { locationId: from.id, code: from.code, ...src }, to: { locationId: to.id, code: to.code, ...dst }, reason: input.note });
    return { movementId, batchNo: batch.batchNo, from: { locationId: from.id, code: from.code, ...src }, to: { locationId: to.id, code: to.code, ...dst } };
  });
}

// ---------- 報損（FR-014） ----------

export interface DamageInput { batchId: number; locationId: number; quantity: number; reason: string }

export function damage(db: Db, input: DamageInput, ctx: Ctx) {
  return runStockTx(db, ctx, () => {
    const batch = db.one<{ id: number; batchNo: string; productId: number; name: string }>("SELECT b.id, b.batchNo, b.productId, p.name FROM Batch b JOIN Product p ON p.id = b.productId WHERE b.id = ?", input.batchId);
    if (!batch) throw notFound("批次");
    const loc = loadLocation(db, input.locationId);
    const r = removeInventory(db, batch.id, loc.id, input.quantity, `批次 ${batch.batchNo} 於儲位 ${loc.code}`);
    const movementId = createMovement(db, ctx.operator.id, { type: "DAMAGE", productId: batch.productId, productName: batch.name, batchId: batch.id, quantity: input.quantity, from: { locationId: loc.id, code: loc.code, ...r }, reason: input.reason });
    return { movementId, batchNo: batch.batchNo, locationCode: loc.code, ...r };
  });
}

// ---------- 盤點核准／退回（FR-015，僅 ADMIN；路由層檢查） ----------

export function approveStocktake(db: Db, stocktakeId: number, reviewNote: string | null, ctx: Ctx) {
  return runStockTx(db, ctx, () => {
    const st = db.one<{ id: number; status: string }>("SELECT id, status FROM Stocktake WHERE id = ?", stocktakeId);
    if (!st) throw notFound("盤點單");
    if (st.status !== "PENDING") throw new AppError("STOCKTAKE_NOT_PENDING", 409, `盤點單 #${st.id} 已${st.status === "APPROVED" ? "核准" : "退回"}，不可再操作`);
    const items = db.all<{ id: number; locationId: number; batchId: number; systemQty: number; countedQty: number; diff: number; locationCode: string; batchNo: string; productId: number; productName: string }>(
      `SELECT si.id, si.locationId, si.batchId, si.systemQty, si.countedQty, si.diff, l.code AS locationCode, b.batchNo, b.productId, p.name AS productName
       FROM StocktakeItem si JOIN Location l ON l.id = si.locationId JOIN Batch b ON b.id = si.batchId JOIN Product p ON p.id = b.productId WHERE si.stocktakeId = ?`, st.id);
    const conflicts = items.flatMap((item) => {
      const current = db.one<{ quantity: number }>("SELECT quantity FROM Inventory WHERE batchId = ? AND locationId = ?", item.batchId, item.locationId)?.quantity ?? 0;
      return current !== item.systemQty ? [{ locationCode: item.locationCode, batchNo: item.batchNo, systemQty: item.systemQty, current }] : [];
    });
    if (conflicts.length > 0) {
      throw new AppError("STOCKTAKE_CONFLICT", 409, `無法核准：盤點提交後庫存已變動（${conflicts.map((c) => `${c.locationCode} ${c.batchNo}：基準 ${c.systemQty}、目前 ${c.current}`).join("；")}）。請退回並重新盤點。`, { conflicts });
    }
    const movementIds: number[] = [];
    for (const item of items) {
      if (item.diff === 0) continue;
      const label = `批次 ${item.batchNo} 於儲位 ${item.locationCode}`;
      const r = item.diff > 0 ? addInventory(db, item.batchId, item.locationId, item.diff) : removeInventory(db, item.batchId, item.locationId, -item.diff, label);
      const side = { locationId: item.locationId, code: item.locationCode, ...r };
      movementIds.push(createMovement(db, ctx.operator.id, { type: "ADJUSTMENT", productId: item.productId, productName: item.productName, batchId: item.batchId, quantity: Math.abs(item.diff), ...(item.diff > 0 ? { to: side } : { from: side }), reason: `盤點 #${st.id} 核准調整（實盤 ${item.countedQty}）${reviewNote ? "：" + reviewNote : ""}`, referenceType: "STOCKTAKE", referenceId: st.id }));
    }
    db.run("UPDATE Stocktake SET status = 'APPROVED', reviewedById = ?, reviewedAt = ?, reviewNote = ? WHERE id = ?", ctx.operator.id, new Date().toISOString(), reviewNote, st.id);
    return { stocktakeId: st.id, status: "APPROVED" as const, adjustments: movementIds.length, movementIds };
  });
}

export function rejectStocktake(db: Db, stocktakeId: number, reviewNote: string | null, ctx: Ctx) {
  const st = db.one<{ id: number; status: string }>("SELECT id, status FROM Stocktake WHERE id = ?", stocktakeId);
  if (!st) throw notFound("盤點單");
  if (st.status !== "PENDING") throw new AppError("STOCKTAKE_NOT_PENDING", 409, `盤點單 #${st.id} 已處理，不可再操作`);
  db.run("UPDATE Stocktake SET status = 'REJECTED', reviewedById = ?, reviewedAt = ?, reviewNote = ? WHERE id = ?", ctx.operator.id, new Date().toISOString(), reviewNote, st.id);
  return { stocktakeId: st.id, status: "REJECTED" as const };
}

// ---------- 容量設定（FR-007） ----------

export interface CapacityInput { defaultCapacity?: number | null; items?: Array<{ productId: number; capacity: number }> }

/** 修改容量低於目前占用 → 拒絕（Q3 預設）。 */
export function setCapacities(db: Db, locationId: number, input: CapacityInput, ctx: Ctx) {
  return runStockTx(db, ctx, () => {
    const loc = loadLocation(db, locationId);
    const state = locationState(db, locationId);
    const reject = (productName: string, capacity: number) =>
      new AppError("CAPACITY_BELOW_OCCUPIED", 409, `無法設定：儲位 ${loc.code} 目前存放「${productName}」${state.occupied}，容量不可設為 ${capacity}。請先搬移或出庫。`, { occupied: state.occupied, capacity });
    for (const item of input.items ?? []) {
      const p = db.one<{ id: number; name: string }>("SELECT id, name FROM Product WHERE id = ?", item.productId);
      if (!p) throw notFound("商品");
      if (state.currentProductId === p.id && item.capacity < state.occupied) throw reject(p.name, item.capacity);
      db.run("INSERT INTO LocationCapacity (locationId, productId, capacity) VALUES (?, ?, ?) ON CONFLICT(locationId, productId) DO UPDATE SET capacity = excluded.capacity", locationId, p.id, item.capacity);
    }
    if (input.defaultCapacity !== undefined) {
      if (input.defaultCapacity !== null && state.currentProductId !== null) {
        const specific = db.one("SELECT 1 FROM LocationCapacity WHERE locationId = ? AND productId = ?", locationId, state.currentProductId);
        if (!specific && input.defaultCapacity < state.occupied) throw reject(state.currentProductName ?? "", input.defaultCapacity);
      }
      db.run("UPDATE Location SET defaultCapacity = ? WHERE id = ?", input.defaultCapacity, locationId);
    }
    const items = db.all<{ productId: number; productName: string; capacity: number }>("SELECT c.productId, p.name AS productName, c.capacity FROM LocationCapacity c JOIN Product p ON p.id = c.productId WHERE c.locationId = ?", locationId);
    const updated = db.one<{ defaultCapacity: number | null }>("SELECT defaultCapacity FROM Location WHERE id = ?", locationId)!;
    return { locationId, defaultCapacity: updated.defaultCapacity, items };
  });
}
