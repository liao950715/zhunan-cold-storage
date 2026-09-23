/**
 * FR-005 布局編輯：儲存貨架／儲位幾何、新增、軟刪除。只動幾何欄位，絕不觸碰 Inventory／StockMovement（AT-16）。
 */
import type { Db } from "../lib/sql.js";
import { AppError, notFound, validation } from "../lib/errors.js";

export interface LocationInput { id?: number; code: string; x: number; y: number; width: number; height: number; defaultCapacity?: number | null }
export interface RackInput { id?: number; code: string; label?: string | null; x: number; y: number; width: number; height: number; rotation?: number; locations: LocationInput[] }
export interface LayoutInput { version: number; width?: number; height?: number; layout?: Record<string, unknown>; racks: RackInput[] }

const inside = (inner: { x: number; y: number; width: number; height: number }, w: number, h: number) => inner.x >= 0 && inner.y >= 0 && inner.x + inner.width <= w && inner.y + inner.height <= h;

/** 越界拒絕；重疊只在前端警告（Q4）。 */
function validateGeometry(input: LayoutInput, width: number, height: number) {
  const rackCodes = new Set<string>();
  const locCodes = new Set<string>();
  for (const r of input.racks) {
    if (rackCodes.has(r.code)) throw validation(`貨架代碼「${r.code}」重複`);
    rackCodes.add(r.code);
    if (!inside(r, width, height)) throw validation(`貨架「${r.code}」超出冷凍庫範圍（${width}×${height}）`, { rack: r.code });
    for (const l of r.locations) {
      if (locCodes.has(l.code)) throw validation(`儲位代碼「${l.code}」重複`);
      locCodes.add(l.code);
      if (!inside(l, r.width, r.height)) throw validation(`儲位「${l.code}」超出貨架「${r.code}」範圍`, { location: l.code });
    }
  }
}

export function saveLayout(db: Db, warehouseId: number, input: LayoutInput) {
  return db.tx(() => {
    const wh = db.one<{ id: number; width: number; height: number; layoutVersion: number }>("SELECT id, width, height, layoutVersion FROM Warehouse WHERE id = ?", warehouseId);
    if (!wh) throw notFound("冷凍庫");
    if (wh.layoutVersion !== input.version) throw new AppError("CONCURRENT_UPDATE", 409, "布局已被其他人修改，請重新整理後再編輯", { current: wh.layoutVersion, submitted: input.version });
    const width = input.width ?? wh.width;
    const height = input.height ?? wh.height;
    validateGeometry(input, width, height);

    const existingRacks = db.all<{ id: number }>("SELECT id FROM Rack WHERE warehouseId = ? AND status = 'ACTIVE'", warehouseId).map((r) => r.id);
    for (const r of input.racks) {
      let rackId: number;
      if (r.id !== undefined) {
        if (!existingRacks.includes(r.id)) throw validation(`貨架 id ${r.id} 不屬於此冷凍庫`);
        db.run("UPDATE Rack SET code = ?, label = ?, x = ?, y = ?, width = ?, height = ?, rotation = ? WHERE id = ?", r.code, r.label ?? null, r.x, r.y, r.width, r.height, r.rotation ?? 0, r.id);
        rackId = r.id;
      } else {
        if (db.one("SELECT 1 FROM Rack WHERE warehouseId = ? AND code = ?", warehouseId, r.code)) throw new AppError("CONFLICT", 409, `貨架代碼「${r.code}」已存在（含已封存）`);
        rackId = db.insert("INSERT INTO Rack (warehouseId, code, label, x, y, width, height, rotation) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", warehouseId, r.code, r.label ?? null, r.x, r.y, r.width, r.height, r.rotation ?? 0);
      }
      const locIds = db.all<{ id: number }>("SELECT id FROM Location WHERE rackId = ? AND status = 'ACTIVE'", rackId).map((l) => l.id);
      for (const l of r.locations) {
        if (l.id !== undefined) {
          if (!locIds.includes(l.id)) throw validation(`儲位 id ${l.id} 不屬於貨架「${r.code}」（儲位不可跨貨架移動，請用搬移處理庫存）`);
          db.run("UPDATE Location SET code = ?, x = ?, y = ?, width = ?, height = ?, defaultCapacity = ? WHERE id = ?", l.code, l.x, l.y, l.width, l.height, l.defaultCapacity ?? null, l.id);
        } else {
          if (db.one("SELECT 1 FROM Location WHERE code = ?", l.code)) throw new AppError("CONFLICT", 409, `儲位代碼「${l.code}」已存在（含已封存）`);
          db.run("INSERT INTO Location (rackId, code, x, y, width, height, defaultCapacity) VALUES (?, ?, ?, ?, ?, ?, ?)", rackId, l.code, l.x, l.y, l.width, l.height, l.defaultCapacity ?? null);
        }
      }
    }
    db.run("UPDATE Warehouse SET width = ?, height = ?, layoutJson = COALESCE(?, layoutJson), layoutVersion = layoutVersion + 1 WHERE id = ?", width, height, input.layout ? JSON.stringify(input.layout) : null, warehouseId);
    return { id: warehouseId, layoutVersion: wh.layoutVersion + 1 };
  });
}

/** 有庫存儲位不可刪除（AT-17）；軟刪除保留歷史。 */
export function deleteLocation(db: Db, locationId: number) {
  return db.tx(() => {
    const loc = db.one<{ id: number; code: string; status: string; warehouseId: number }>("SELECT l.id, l.code, l.status, r.warehouseId FROM Location l JOIN Rack r ON r.id = l.rackId WHERE l.id = ?", locationId);
    if (!loc || loc.status !== "ACTIVE") throw notFound("儲位");
    const qty = db.one<{ q: number }>("SELECT COALESCE(SUM(quantity), 0) AS q FROM Inventory WHERE locationId = ?", locationId)!.q;
    if (qty > 0) throw new AppError("LOCATION_NOT_EMPTY", 409, `無法刪除：儲位 ${loc.code} 尚有庫存 ${qty}。請先出庫或搬移後再刪除。`, { locationCode: loc.code, quantity: qty });
    db.run("UPDATE Location SET status = 'ARCHIVED' WHERE id = ?", locationId);
    db.run("UPDATE Warehouse SET layoutVersion = layoutVersion + 1 WHERE id = ?", loc.warehouseId);
    return { id: locationId, code: loc.code };
  });
}

/** 貨架下任一儲位有庫存即拒絕；否則貨架與其儲位一併軟刪除（Q5）。 */
export function deleteRack(db: Db, rackId: number) {
  return db.tx(() => {
    const rack = db.one<{ id: number; code: string; status: string; warehouseId: number }>("SELECT id, code, status, warehouseId FROM Rack WHERE id = ?", rackId);
    if (!rack || rack.status !== "ACTIVE") throw notFound("貨架");
    const stocked = db.all<{ code: string }>("SELECT l.code FROM Location l WHERE l.rackId = ? AND l.status = 'ACTIVE' AND EXISTS (SELECT 1 FROM Inventory i WHERE i.locationId = l.id AND i.quantity > 0)", rackId).map((l) => l.code);
    if (stocked.length) throw new AppError("LOCATION_NOT_EMPTY", 409, `無法刪除：貨架 ${rack.code} 的儲位 ${stocked.join("、")} 尚有庫存。請先清空後再刪除。`, { locations: stocked });
    const n = db.run("UPDATE Location SET status = 'ARCHIVED' WHERE rackId = ? AND status = 'ACTIVE'", rackId);
    db.run("UPDATE Rack SET status = 'ARCHIVED' WHERE id = ?", rackId);
    db.run("UPDATE Warehouse SET layoutVersion = layoutVersion + 1 WHERE id = ?", rack.warehouseId);
    return { id: rackId, code: rack.code, archivedLocations: n };
  });
}
