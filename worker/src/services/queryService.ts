/** 唯讀查詢：商品、批次、儲位、搜尋、布局、異動紀錄、Dashboard、盤點基準。 */
import type { Db } from "../lib/sql.js";
import { AppError, notFound } from "../lib/errors.js";
import { daysBetween, todayString } from "../lib/dates.js";

export interface StockLineRow {
  inventoryId: number; quantity: number;
  productId: number; productName: string; unit: string;
  batchId: number; batchNo: string; receivedDate: string; expiryDate: string;
  locationId: number; locationCode: string; rackId: number; rackCode: string; warehouseId: number; warehouseCode: string; warehouseName: string;
}

const LINE_SQL = `SELECT i.id AS inventoryId, i.quantity, p.id AS productId, p.name AS productName, p.unit,
  b.id AS batchId, b.batchNo, b.receivedDate, b.expiryDate,
  l.id AS locationId, l.code AS locationCode, r.id AS rackId, r.code AS rackCode, w.id AS warehouseId, w.code AS warehouseCode, w.name AS warehouseName
  FROM Inventory i JOIN Batch b ON b.id = i.batchId JOIN Product p ON p.id = b.productId
  JOIN Location l ON l.id = i.locationId JOIN Rack r ON r.id = l.rackId JOIN Warehouse w ON w.id = r.warehouseId
  WHERE i.quantity > 0`;

export function toStockLine(r: StockLineRow) {
  return {
    inventoryId: r.inventoryId, quantity: r.quantity,
    product: { id: r.productId, name: r.productName, unit: r.unit },
    batch: { id: r.batchId, batchNo: r.batchNo, receivedDate: r.receivedDate, expiryDate: r.expiryDate },
    location: { id: r.locationId, code: r.locationCode, rackId: r.rackId, rackCode: r.rackCode, warehouseId: r.warehouseId, warehouseCode: r.warehouseCode, warehouseName: r.warehouseName },
  };
}

// ---- 商品 ----
export interface ProductInput { name: string; category?: string | null; unit: string; lowStockThreshold?: number; expiryAlertDays?: number; note?: string | null }

export function listProducts(db: Db, opts: { q?: string; includeInactive?: boolean }) {
  const where = [opts.includeInactive ? "1=1" : "status = 'ACTIVE'", opts.q ? "name LIKE ?" : "1=1"].join(" AND ");
  const items = db.all("SELECT * FROM Product WHERE " + where + " ORDER BY name", ...(opts.q ? [`%${opts.q}%`] : []));
  return { items, total: items.length };
}
export function getProduct(db: Db, id: number) {
  const p = db.one<{ id: number; name: string; unit: string }>("SELECT * FROM Product WHERE id = ?", id);
  if (!p) throw notFound("商品");
  return p;
}
export function createProduct(db: Db, input: ProductInput) {
  if (db.one("SELECT 1 FROM Product WHERE name = ?", input.name)) throw new AppError("CONFLICT", 409, `商品名稱「${input.name}」已存在`);
  const id = db.insert("INSERT INTO Product (name, category, unit, lowStockThreshold, expiryAlertDays, note) VALUES (?, ?, ?, ?, ?, ?)", input.name, input.category ?? null, input.unit, input.lowStockThreshold ?? 0, input.expiryAlertDays ?? 7, input.note ?? null);
  return getProduct(db, id);
}
/** 已有批次的商品不可改單位（UNIT_LOCKED）；改名允許。 */
export function updateProduct(db: Db, id: number, input: Partial<ProductInput> & { status?: "ACTIVE" | "INACTIVE" }) {
  const p = getProduct(db, id);
  if (input.unit !== undefined && input.unit !== p.unit) {
    const n = db.one<{ n: number }>("SELECT COUNT(*) AS n FROM Batch WHERE productId = ?", id)!.n;
    if (n > 0) throw new AppError("UNIT_LOCKED", 409, `商品「${p.name}」已有 ${n} 個批次，計量單位不可再修改`);
  }
  if (input.name !== undefined && input.name !== p.name && db.one("SELECT 1 FROM Product WHERE name = ?", input.name)) throw new AppError("CONFLICT", 409, `商品名稱「${input.name}」已存在`);
  const fields = ["name", "category", "unit", "lowStockThreshold", "expiryAlertDays", "note", "status"] as const;
  const sets = fields.filter((f) => input[f] !== undefined);
  if (sets.length) db.run(`UPDATE Product SET ${sets.map((f) => `${f} = ?`).join(", ")}, updatedAt = ? WHERE id = ?`, ...sets.map((f) => input[f] ?? null), new Date().toISOString(), id);
  return getProduct(db, id);
}

// ---- 庫存明細 ----
export function getProductStock(db: Db, productId: number) {
  const product = getProduct(db, productId);
  const lines = db.all<StockLineRow>(LINE_SQL + " AND b.productId = ? ORDER BY b.expiryDate, l.code", productId).map(toStockLine);
  const total = lines.reduce((s, l) => s + l.quantity, 0);
  const byBatch = new Map<number, { batch: (typeof lines)[number]["batch"]; quantity: number; locations: number }>();
  for (const l of lines) {
    const b = byBatch.get(l.batch.id) ?? { batch: l.batch, quantity: 0, locations: 0 };
    b.quantity += l.quantity; b.locations += 1; byBatch.set(l.batch.id, b);
  }
  return { product, total, batches: [...byBatch.values()], lines };
}

export function getLocationDetail(db: Db, locationId: number) {
  const loc = db.one<{ id: number; code: string; status: string; defaultCapacity: number | null; rackId: number; rackCode: string; warehouseId: number; warehouseCode: string }>(
    "SELECT l.id, l.code, l.status, l.defaultCapacity, l.rackId, r.code AS rackCode, r.warehouseId, w.code AS warehouseCode FROM Location l JOIN Rack r ON r.id = l.rackId JOIN Warehouse w ON w.id = r.warehouseId WHERE l.id = ?", locationId);
  if (!loc) throw notFound("儲位");
  const lines = db.all<StockLineRow>(LINE_SQL + " AND i.locationId = ? ORDER BY b.expiryDate", locationId).map(toStockLine);
  const capacities = db.all<{ productId: number; productName: string; capacity: number }>("SELECT c.productId, p.name AS productName, c.capacity FROM LocationCapacity c JOIN Product p ON p.id = c.productId WHERE c.locationId = ?", locationId);
  return { location: loc, currentProduct: lines[0]?.product ?? null, occupied: lines.reduce((s, l) => s + l.quantity, 0), capacities, lines };
}

export function listBatches(db: Db, q: { productId?: number; q?: string; inStockOnly?: boolean }) {
  const rows = db.all<{ id: number; batchNo: string; productId: number; receivedDate: string; expiryDate: string; initialQty: number; note: string | null; available: number; productName: string; unit: string }>(
    `SELECT b.*, p.name AS productName, p.unit, COALESCE((SELECT SUM(quantity) FROM Inventory i WHERE i.batchId = b.id), 0) AS available
     FROM Batch b JOIN Product p ON p.id = b.productId WHERE (? IS NULL OR b.productId = ?) AND (? IS NULL OR b.batchNo LIKE ?)
     ORDER BY b.expiryDate, b.batchNo`, q.productId ?? null, q.productId ?? null, q.q ?? null, q.q ? `%${q.q}%` : null);
  const items = rows.filter((r) => !q.inStockOnly || r.available > 0).map(({ productName, unit, ...b }) => ({ ...b, product: { id: b.productId, name: productName, unit } }));
  return { items, total: items.length };
}
export function getBatch(db: Db, id: number) {
  const b = db.one<{ id: number; batchNo: string; productId: number; receivedDate: string; expiryDate: string; initialQty: number; note: string | null; createdById: number; createdAt: string }>("SELECT * FROM Batch WHERE id = ?", id);
  if (!b) throw notFound("批次");
  const product = getProduct(db, b.productId);
  const lines = db.all<StockLineRow>(LINE_SQL + " AND i.batchId = ? ORDER BY l.code", id).map(toStockLine);
  return { ...b, product, available: lines.reduce((s, l) => s + l.quantity, 0), lines };
}

// ---- 搜尋（FR-019） ----
export function search(db: Db, q: string) {
  const term = q.trim();
  if (!term) return { query: term, products: [], lines: [] };
  const like = `%${term}%`;
  const products = db.all<{ id: number; name: string; unit: string; category: string | null }>("SELECT id, name, unit, category FROM Product WHERE name LIKE ? AND status = 'ACTIVE' ORDER BY name", like);
  const lines = db.all<StockLineRow>(LINE_SQL + " AND (p.name LIKE ? OR b.batchNo LIKE ? OR l.code LIKE ?) ORDER BY b.expiryDate, l.code", like, like, like).map(toStockLine);
  return { query: term, products, lines };
}

// ---- 冷凍庫與布局 ----
export function listWarehouses(db: Db) {
  const items = db.all(
    `SELECT w.id, w.code, w.name, w.width, w.height, w.layoutVersion,
      (SELECT COUNT(*) FROM Rack r WHERE r.warehouseId = w.id AND r.status = 'ACTIVE') AS rackCount,
      (SELECT COUNT(*) FROM Location l JOIN Rack r ON r.id = l.rackId WHERE r.warehouseId = w.id AND r.status = 'ACTIVE' AND l.status = 'ACTIVE') AS locationCount
     FROM Warehouse w ORDER BY w.code`);
  return { items, total: items.length };
}

export function getLayout(db: Db, id: number) {
  const w = db.one<{ id: number; code: string; name: string; width: number; height: number; layoutJson: string; layoutVersion: number }>("SELECT * FROM Warehouse WHERE id = ?", id);
  if (!w) throw notFound("冷凍庫");
  const racks = db.all<{ id: number; warehouseId: number; code: string; label: string | null; x: number; y: number; width: number; height: number; rotation: number; status: string }>("SELECT * FROM Rack WHERE warehouseId = ? AND status = 'ACTIVE' ORDER BY code", id);
  const locs = db.all<{ id: number; rackId: number; code: string; x: number; y: number; width: number; height: number; defaultCapacity: number | null; status: string; quantity: number; batchCount: number; productId: number | null; productName: string | null; unit: string | null }>(
    `SELECT l.*, COALESCE(s.quantity, 0) AS quantity, COALESCE(s.batchCount, 0) AS batchCount, s.productId, p.name AS productName, p.unit
     FROM Location l JOIN Rack r ON r.id = l.rackId
     LEFT JOIN (SELECT i.locationId, SUM(i.quantity) AS quantity, COUNT(*) AS batchCount, MIN(b.productId) AS productId FROM Inventory i JOIN Batch b ON b.id = i.batchId WHERE i.quantity > 0 GROUP BY i.locationId) s ON s.locationId = l.id
     LEFT JOIN Product p ON p.id = s.productId
     WHERE r.warehouseId = ? AND l.status = 'ACTIVE' ORDER BY l.code`, id);
  const { layoutJson, ...rest } = w;
  return {
    ...rest,
    layout: JSON.parse(layoutJson || "{}"),
    racks: racks.map((r) => ({
      ...r,
      locations: locs.filter((l) => l.rackId === r.id).map(({ productId, productName, unit, ...loc }) => ({ ...loc, occupied: loc.quantity > 0, product: productId ? { id: productId, name: productName, unit } : null })),
    })),
  };
}

// ---- 異動紀錄（FR-016） ----
export function listMovements(db: Db, q: { type?: string; productId?: number; batchId?: number; locationId?: number; dateFrom?: string; dateTo?: string; limit: number; offset: number }) {
  const conds: string[] = [];
  const params: unknown[] = [];
  if (q.type) { conds.push("m.type = ?"); params.push(q.type); }
  if (q.productId) { conds.push("m.productId = ?"); params.push(q.productId); }
  if (q.batchId) { conds.push("m.batchId = ?"); params.push(q.batchId); }
  if (q.locationId) { conds.push("(m.fromLocationId = ? OR m.toLocationId = ?)"); params.push(q.locationId, q.locationId); }
  if (q.dateFrom) { conds.push("m.createdAt >= ?"); params.push(`${q.dateFrom}T00:00:00`); }
  if (q.dateTo) { conds.push("m.createdAt < ?"); params.push(`${q.dateTo}T23:59:59.999`); }
  const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
  const total = db.one<{ n: number }>(`SELECT COUNT(*) AS n FROM StockMovement m ${where}`, ...params)!.n;
  const rows = db.all<Record<string, string | number | null>>(
    `SELECT m.*, b.batchNo, p.name AS productName, p.unit, lf.code AS fromCode, lt.code AS toCode, u.displayName AS operatorName
     FROM StockMovement m JOIN Batch b ON b.id = m.batchId JOIN Product p ON p.id = m.productId
     LEFT JOIN Location lf ON lf.id = m.fromLocationId LEFT JOIN Location lt ON lt.id = m.toLocationId JOIN User u ON u.id = m.operatorId
     ${where} ORDER BY m.id DESC LIMIT ? OFFSET ?`, ...params, q.limit, q.offset);
  const items = rows.map(({ batchNo, productName, unit, fromCode, toCode, operatorName, ...m }) => ({
    ...m, batch: { batchNo }, product: { name: productName, unit }, fromLocation: fromCode ? { code: fromCode } : null, toLocation: toCode ? { code: toCode } : null, operator: { id: m.operatorId, displayName: operatorName },
  }));
  return { items, total };
}

// ---- 盤點查詢 ----
export function stocktakeBaseline(db: Db, warehouseId?: number) {
  return db.all<StockLineRow>(LINE_SQL + (warehouseId ? " AND w.id = ?" : "") + " ORDER BY l.code", ...(warehouseId ? [warehouseId] : [])).map((r) => ({
    locationId: r.locationId, locationCode: r.locationCode, batchId: r.batchId, batchNo: r.batchNo, expiryDate: r.expiryDate, product: { id: r.productId, name: r.productName, unit: r.unit }, systemQty: r.quantity,
  }));
}

function serializeStocktake(db: Db, s: Record<string, unknown>) {
  const items = db.all<{ id: number; locationId: number; batchId: number; systemQty: number; countedQty: number; diff: number; locationCode: string; batchNo: string; expiryDate: string; productId: number; productName: string; unit: string }>(
    `SELECT si.*, l.code AS locationCode, b.batchNo, b.expiryDate, p.id AS productId, p.name AS productName, p.unit
     FROM StocktakeItem si JOIN Location l ON l.id = si.locationId JOIN Batch b ON b.id = si.batchId JOIN Product p ON p.id = b.productId WHERE si.stocktakeId = ? ORDER BY l.code`, s.id);
  const user = (id: unknown) => (id ? db.one<{ id: number; displayName: string }>("SELECT id, displayName FROM User WHERE id = ?", id) : null);
  const warehouse = s.warehouseId ? db.one<{ id: number; code: string; name: string }>("SELECT id, code, name FROM Warehouse WHERE id = ?", s.warehouseId) : null;
  return {
    ...s, warehouse, submittedBy: user(s.submittedById), reviewedBy: user(s.reviewedById),
    items: items.map((i) => ({ id: i.id, locationId: i.locationId, locationCode: i.locationCode, batchId: i.batchId, batchNo: i.batchNo, expiryDate: i.expiryDate, product: { id: i.productId, name: i.productName, unit: i.unit }, systemQty: i.systemQty, countedQty: i.countedQty, diff: i.diff })),
  };
}
export function listStocktakes(db: Db, status?: string) {
  const rows = db.all<Record<string, unknown>>("SELECT * FROM Stocktake WHERE (? IS NULL OR status = ?) ORDER BY id DESC", status ?? null, status ?? null);
  const items = rows.map((s) => serializeStocktake(db, s));
  return { items, total: items.length };
}
export function getStocktake(db: Db, id: number) {
  const s = db.one<Record<string, unknown>>("SELECT * FROM Stocktake WHERE id = ?", id);
  if (!s) throw notFound("盤點單");
  return serializeStocktake(db, s);
}
/** 提交只建立待核准單（不改庫存）；記錄提交當下 systemQty 作核准基準（AT-24）。 */
export function submitStocktake(db: Db, input: { warehouseId?: number; note?: string | null; items: Array<{ locationId: number; batchId: number; countedQty: number }> }, operatorId: number) {
  const keys = input.items.map((i) => `${i.locationId}:${i.batchId}`);
  if (new Set(keys).size !== keys.length) throw new AppError("VALIDATION_ERROR", 400, "同一儲位＋批次不可重複盤點");
  return db.tx(() => {
    const id = db.insert("INSERT INTO Stocktake (warehouseId, note, submittedById) VALUES (?, ?, ?)", input.warehouseId ?? null, input.note ?? null, operatorId);
    for (const i of input.items) {
      if (!db.one("SELECT 1 FROM Location WHERE id = ? AND status = 'ACTIVE'", i.locationId)) throw notFound("儲位");
      if (!db.one("SELECT 1 FROM Batch WHERE id = ?", i.batchId)) throw notFound("批次");
      const systemQty = db.one<{ quantity: number }>("SELECT quantity FROM Inventory WHERE batchId = ? AND locationId = ?", i.batchId, i.locationId)?.quantity ?? 0;
      db.run("INSERT INTO StocktakeItem (stocktakeId, locationId, batchId, systemQty, countedQty, diff) VALUES (?, ?, ?, ?, ?, ?)", id, i.locationId, i.batchId, systemQty, i.countedQty, i.countedQty - systemQty);
    }
    return getStocktake(db, id);
  });
}

// ---- Dashboard（FR-017／018） ----
export function getDashboard(db: Db, today = todayString()) {
  const products = db.all<{ id: number; name: string; unit: string; lowStockThreshold: number; expiryAlertDays: number }>("SELECT id, name, unit, lowStockThreshold, expiryAlertDays FROM Product WHERE status = 'ACTIVE'");
  const rows = db.all<StockLineRow & { expiryAlertDays: number }>(LINE_SQL.replace("p.unit,", "p.unit, p.expiryAlertDays,"));
  const totalLocations = db.one<{ n: number }>("SELECT COUNT(*) AS n FROM Location l JOIN Rack r ON r.id = l.rackId WHERE l.status = 'ACTIVE' AND r.status = 'ACTIVE'")!.n;
  const pendingStocktakes = db.one<{ n: number }>("SELECT COUNT(*) AS n FROM Stocktake WHERE status = 'PENDING'")!.n;

  const byProduct = new Map<number, number>();
  const byUnit = new Map<string, number>();
  const occupied = new Set<number>();
  const batches = new Set<number>();
  const expiryMap = new Map<number, { batchId: number; batchNo: string; product: { id: number; name: string; unit: string }; expiryDate: string; daysLeft: number; expired: boolean; quantity: number; locations: string[] }>();
  for (const r of rows) {
    byProduct.set(r.productId, (byProduct.get(r.productId) ?? 0) + r.quantity);
    byUnit.set(r.unit, (byUnit.get(r.unit) ?? 0) + r.quantity);
    occupied.add(r.locationId);
    batches.add(r.batchId);
    const daysLeft = daysBetween(today, r.expiryDate);
    if (daysLeft <= r.expiryAlertDays) {
      const e = expiryMap.get(r.batchId) ?? { batchId: r.batchId, batchNo: r.batchNo, product: { id: r.productId, name: r.productName, unit: r.unit }, expiryDate: r.expiryDate, daysLeft, expired: daysLeft < 0, quantity: 0, locations: [] };
      e.quantity += r.quantity; e.locations.push(r.locationCode); expiryMap.set(r.batchId, e);
    }
  }
  const lowStock = products
    .filter((p) => p.lowStockThreshold > 0 && (byProduct.get(p.id) ?? 0) <= p.lowStockThreshold)
    .map((p) => ({ productId: p.id, name: p.name, unit: p.unit, available: byProduct.get(p.id) ?? 0, threshold: p.lowStockThreshold }))
    .sort((a, b) => a.available / a.threshold - b.available / b.threshold);
  return {
    stats: { activeProducts: products.length, productsInStock: byProduct.size, batchesInStock: batches.size, occupiedLocations: occupied.size, totalLocations, pendingStocktakes },
    totalsByUnit: [...byUnit.entries()].map(([unit, quantity]) => ({ unit, quantity })).sort((a, b) => b.quantity - a.quantity),
    expiryAlerts: [...expiryMap.values()].sort((a, b) => a.daysLeft - b.daysLeft),
    lowStock,
  };
}
