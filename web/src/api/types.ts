export type Role = "ADMIN" | "STAFF";

export interface AuthUser {
  id: number;
  username: string;
  displayName: string;
  role: Role;
}

export interface Product {
  id: number;
  name: string;
  category: string | null;
  unit: string;
  lowStockThreshold: number;
  expiryAlertDays: number;
  status: "ACTIVE" | "INACTIVE";
  note: string | null;
}

export interface LayoutLocation {
  id: number;
  rackId: number;
  code: string;
  x: number;
  y: number;
  width: number;
  height: number;
  defaultCapacity: number | null;
  occupied: boolean;
  quantity: number;
  batchCount: number;
  product: { id: number; name: string; unit: string } | null;
}

export interface LayoutRack {
  id: number;
  warehouseId: number;
  code: string;
  label: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  locations: LayoutLocation[];
}

export interface WarehouseLayout {
  id: number;
  code: string;
  name: string;
  width: number;
  height: number;
  layoutVersion: number;
  layout: { entrance?: Rect; aisles?: Rect[] };
  racks: LayoutRack[];
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WarehouseSummary {
  id: number;
  code: string;
  name: string;
  width: number;
  height: number;
  layoutVersion: number;
  rackCount: number;
  locationCount: number;
}

export interface StockLine {
  inventoryId: number;
  quantity: number;
  product: { id: number; name: string; unit: string };
  batch: { id: number; batchNo: string; receivedDate: string; expiryDate: string };
  location: { id: number; code: string; rackId: number; rackCode: string; warehouseId: number; warehouseCode: string; warehouseName: string };
}

export interface LocationDetail {
  location: { id: number; code: string; status: string; defaultCapacity: number | null; rackId: number; rackCode: string; warehouseId: number; warehouseCode: string };
  currentProduct: { id: number; name: string; unit: string } | null;
  occupied: number;
  capacities: Array<{ productId: number; productName: string; capacity: number }>;
  lines: StockLine[];
}

/** 送給 PUT /warehouses/:id/layout 的可編輯草稿 */
export interface DraftLocation {
  id?: number;
  code: string;
  x: number;
  y: number;
  width: number;
  height: number;
  defaultCapacity: number | null;
  // 僅前端顯示用
  occupied?: boolean;
  quantity?: number;
  product?: LayoutLocation["product"];
}

export interface DraftRack {
  id?: number;
  key: string; // 前端暫存 key（新貨架尚無 id）
  code: string;
  label: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  locations: DraftLocation[];
}
