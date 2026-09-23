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
  /** 對目前存放商品的有效容量（商品專屬容量 > 預設）；null＝未設定，不可推測已滿 */
  capacity: number | null;
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
  capacity?: number | null;
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

export interface BatchItem {
  id: number;
  batchNo: string;
  productId: number;
  receivedDate: string;
  expiryDate: string;
  initialQty: number;
  note: string | null;
  available: number;
  product: { id: number; name: string; unit: string };
}

export interface ProductStock {
  product: Product;
  total: number;
  batches: Array<{ batch: StockLine["batch"]; quantity: number; locations: number }>;
  lines: StockLine[];
}

export interface SearchResult {
  query: string;
  products: Array<{ id: number; name: string; unit: string; category: string | null }>;
  lines: StockLine[];
}

export interface FefoSuggestion {
  product: { id: number; name: string; unit: string };
  requested: number;
  available: number;
  shortage: number;
  suggestions: Array<{ batchId: number; batchNo: string; expiryDate: string; expired: boolean; locationId: number; locationCode: string; available: number; take: number }>;
}

export type MovementType = "IN" | "OUT" | "TRANSFER" | "DAMAGE" | "ADJUSTMENT";

export interface Movement {
  id: number;
  type: MovementType;
  productId: number;
  batchId: number;
  fromLocationId: number | null;
  toLocationId: number | null;
  quantity: number;
  fromBeforeQty: number | null;
  fromAfterQty: number | null;
  toBeforeQty: number | null;
  toAfterQty: number | null;
  productNameSnapshot: string;
  locationCodeSnapshot: string;
  reason: string | null;
  referenceType: string | null;
  referenceId: number | null;
  createdAt: string;
  batch: { batchNo: string };
  product: { name: string; unit: string };
  fromLocation: { code: string } | null;
  toLocation: { code: string } | null;
  operator: { id: number; displayName: string };
}

export interface StocktakeItem {
  id: number;
  locationId: number;
  locationCode: string;
  batchId: number;
  batchNo: string;
  expiryDate: string;
  product: { id: number; name: string; unit: string };
  systemQty: number;
  countedQty: number;
  diff: number;
}

export interface Stocktake {
  id: number;
  status: "PENDING" | "APPROVED" | "REJECTED";
  warehouseId: number | null;
  warehouse: { id: number; code: string; name: string } | null;
  note: string | null;
  submittedAt: string;
  submittedBy: { id: number; displayName: string };
  reviewedAt: string | null;
  reviewedBy: { id: number; displayName: string } | null;
  reviewNote: string | null;
  items: StocktakeItem[];
}

export interface BaselineItem {
  locationId: number;
  locationCode: string;
  batchId: number;
  batchNo: string;
  expiryDate: string;
  product: { id: number; name: string; unit: string };
  systemQty: number;
}

export interface Dashboard {
  stats: { activeProducts: number; productsInStock: number; batchesInStock: number; occupiedLocations: number; totalLocations: number; pendingStocktakes: number };
  totalsByUnit: Array<{ unit: string; quantity: number }>;
  expiryAlerts: Array<{ batchId: number; batchNo: string; product: { id: number; name: string; unit: string }; expiryDate: string; daysLeft: number; expired: boolean; quantity: number; locations: string[] }>;
  lowStock: Array<{ productId: number; name: string; unit: string; available: number; threshold: number }>;
}

export interface UserItem {
  id: number;
  username: string;
  displayName: string;
  role: Role;
  status: "ACTIVE" | "DISABLED";
}
