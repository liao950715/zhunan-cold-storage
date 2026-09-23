import type { DraftLocation, DraftRack, Rect, WarehouseLayout } from "../../api/types";

export const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

/** 貨架限制在冷凍庫內；儲位限制在貨架內（越界後端也會拒絕）。 */
export function clampRect(r: Rect, outerW: number, outerH: number): Rect {
  return { ...r, x: clamp(Math.round(r.x), 0, Math.max(0, outerW - r.width)), y: clamp(Math.round(r.y), 0, Math.max(0, outerH - r.height)) };
}

export const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

/** 重疊只警告不阻擋（Q4）：回傳有重疊的貨架代碼配對。 */
export function findRackOverlaps(racks: DraftRack[]): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (let i = 0; i < racks.length; i++) for (let j = i + 1; j < racks.length; j++) if (overlaps(racks[i], racks[j])) out.push([racks[i].code, racks[j].code]);
  return out;
}

export function toDraft(layout: WarehouseLayout): DraftRack[] {
  return layout.racks.map((r) => ({
    id: r.id,
    key: `r${r.id}`,
    code: r.code,
    label: r.label,
    x: r.x,
    y: r.y,
    width: r.width,
    height: r.height,
    locations: r.locations.map((l) => ({ id: l.id, code: l.code, x: l.x, y: l.y, width: l.width, height: l.height, defaultCapacity: l.defaultCapacity, occupied: l.occupied, quantity: l.quantity, product: l.product })),
  }));
}

export function toPayload(version: number, racks: DraftRack[]) {
  return {
    version,
    racks: racks.map(({ key: _k, locations, ...r }) => ({
      ...r,
      locations: locations.map(({ occupied: _o, quantity: _q, product: _p, ...l }) => l),
    })),
  };
}

/** 下一個貨架代碼：01, 02, … 取現有最大值 +1。 */
export function nextRackCode(racks: DraftRack[]): string {
  const max = racks.reduce((m, r) => Math.max(m, Number.parseInt(r.code, 10) || 0), 0);
  return String(max + 1).padStart(2, "0");
}

/** 儲位代碼 {倉庫}-{貨架}-{NN} */
export function nextLocationCode(warehouseCode: string, rack: DraftRack, allCodes: Set<string>): string {
  let n = rack.locations.length + 1;
  let code = `${warehouseCode}-${rack.code}-${String(n).padStart(2, "0")}`;
  while (allCodes.has(code)) {
    n += 1;
    code = `${warehouseCode}-${rack.code}-${String(n).padStart(2, "0")}`;
  }
  return code;
}

/** 新貨架預設 3×2 儲位排版。 */
export function defaultLocations(warehouseCode: string, rack: DraftRack, allCodes: Set<string>, cols = 3, rows = 2): DraftLocation[] {
  const w = Math.floor(rack.width / cols);
  const h = Math.floor(rack.height / rows);
  const locs: DraftLocation[] = [];
  const codes = new Set(allCodes);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const code = nextLocationCode(warehouseCode, { ...rack, locations: locs }, codes);
      codes.add(code);
      locs.push({ code, x: c * w, y: r * h, width: w, height: h, defaultCapacity: 20 });
    }
  return locs;
}
