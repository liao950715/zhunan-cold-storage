/**
 * 資料表定義（對應 docs/DATABASE_DESIGN.md）。
 * 在 Durable Object 的 SQLite 內執行；Inventory.quantity 的 CHECK 是最後防線。
 */
export const SCHEMA_VERSION = 6;

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS User (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  passwordHash TEXT NOT NULL,
  displayName TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ADMIN','STAFF')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED')),
  createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS Product (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  category TEXT,
  unit TEXT NOT NULL,
  lowStockThreshold INTEGER NOT NULL DEFAULT 0,
  expiryAlertDays INTEGER NOT NULL DEFAULT 7,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  note TEXT,
  createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS Batch (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batchNo TEXT NOT NULL UNIQUE,
  productId INTEGER NOT NULL REFERENCES Product(id),
  receivedDate TEXT NOT NULL,
  receivedAt TEXT,            -- 進貨時間（ISO，UTC）；出庫先進先出依此排序
  expiryDate TEXT NOT NULL,
  initialQty INTEGER NOT NULL CHECK (initialQty > 0),
  note TEXT,
  createdById INTEGER NOT NULL REFERENCES User(id),
  createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS Batch_product_expiry ON Batch(productId, expiryDate);
-- Batch_product_received 不能放這裡：舊資料庫此時還沒有 receivedAt 欄位（見 POST_MIGRATION_SQL）

CREATE TABLE IF NOT EXISTS BatchCounter (dateKey TEXT PRIMARY KEY, seq INTEGER NOT NULL DEFAULT 0);

CREATE TABLE IF NOT EXISTS Warehouse (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  layoutJson TEXT NOT NULL DEFAULT '{}',
  layoutVersion INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS Rack (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  warehouseId INTEGER NOT NULL REFERENCES Warehouse(id),
  code TEXT NOT NULL,
  label TEXT,
  x INTEGER NOT NULL, y INTEGER NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
  rotation INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
  UNIQUE (warehouseId, code)
);

CREATE TABLE IF NOT EXISTS Location (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rackId INTEGER NOT NULL REFERENCES Rack(id),
  code TEXT NOT NULL UNIQUE,
  x INTEGER NOT NULL, y INTEGER NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
  defaultCapacity INTEGER,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED'))
);

CREATE TABLE IF NOT EXISTS LocationCapacity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  locationId INTEGER NOT NULL REFERENCES Location(id),
  productId INTEGER NOT NULL REFERENCES Product(id),
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  UNIQUE (locationId, productId)
);

CREATE TABLE IF NOT EXISTS Inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batchId INTEGER NOT NULL REFERENCES Batch(id),
  locationId INTEGER NOT NULL REFERENCES Location(id),
  quantity INTEGER NOT NULL CHECK (quantity >= 0),
  UNIQUE (batchId, locationId)
);
CREATE INDEX IF NOT EXISTS Inventory_location ON Inventory(locationId);

CREATE TABLE IF NOT EXISTS StockMovement (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('IN','OUT','TRANSFER','DAMAGE','ADJUSTMENT','REVERSAL')),
  productId INTEGER NOT NULL REFERENCES Product(id),
  batchId INTEGER NOT NULL REFERENCES Batch(id),
  fromLocationId INTEGER REFERENCES Location(id),
  toLocationId INTEGER REFERENCES Location(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  fromBeforeQty INTEGER, fromAfterQty INTEGER, toBeforeQty INTEGER, toAfterQty INTEGER,
  productNameSnapshot TEXT NOT NULL,
  locationCodeSnapshot TEXT NOT NULL,
  reason TEXT,
  referenceType TEXT,
  referenceId INTEGER,
  operatorId INTEGER NOT NULL REFERENCES User(id),
  createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  -- FR-020 復原：反向異動指向原始異動；UNIQUE ＝ 同一筆原始異動只能復原一次（DB 層防重複）
  reversalOfId INTEGER UNIQUE REFERENCES StockMovement(id),
  reversalReason TEXT
);
CREATE INDEX IF NOT EXISTS Movement_type_time ON StockMovement(type, createdAt);
CREATE INDEX IF NOT EXISTS Movement_product ON StockMovement(productId);
CREATE INDEX IF NOT EXISTS Movement_batch ON StockMovement(batchId);

CREATE TABLE IF NOT EXISTS Stocktake (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  warehouseId INTEGER REFERENCES Warehouse(id),
  note TEXT,
  submittedById INTEGER NOT NULL REFERENCES User(id),
  submittedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  reviewedById INTEGER REFERENCES User(id),
  reviewedAt TEXT,
  reviewNote TEXT
);

CREATE TABLE IF NOT EXISTS StocktakeItem (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stocktakeId INTEGER NOT NULL REFERENCES Stocktake(id),
  locationId INTEGER NOT NULL REFERENCES Location(id),
  batchId INTEGER NOT NULL REFERENCES Batch(id),
  systemQty INTEGER NOT NULL,
  countedQty INTEGER NOT NULL CHECK (countedQty >= 0),
  diff INTEGER NOT NULL,
  reasonCode TEXT,
  reasonNote TEXT,
  UNIQUE (stocktakeId, locationId, batchId)
);

-- 盤點時順手建立的報損（v6）：報損當下已扣庫存，盤點基準隨之更新；這裡只記錄關聯供追溯，核准時不再扣。
-- movementId UNIQUE ＝ 一筆報損只能附在一張盤點單。新表用 IF NOT EXISTS，舊資料庫啟動時自動補建。
CREATE TABLE IF NOT EXISTS StocktakeDamage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stocktakeId INTEGER NOT NULL REFERENCES Stocktake(id),
  movementId INTEGER NOT NULL UNIQUE REFERENCES StockMovement(id)
);
CREATE INDEX IF NOT EXISTS StocktakeDamage_stocktake ON StocktakeDamage(stocktakeId);

CREATE TABLE IF NOT EXISTS IdempotencyKey (
  key TEXT PRIMARY KEY,
  userId INTEGER NOT NULL REFERENCES User(id),
  requestFingerprint TEXT,
  responseJson TEXT NOT NULL,
  createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS PairAttempt (clientKey TEXT PRIMARY KEY, attempts INTEGER NOT NULL, windowStart INTEGER NOT NULL);
`;

/** v1 → v2：StockMovement 加 REVERSAL 類型與 reversalOfId／reversalReason（SQLite 無法改 CHECK，需重建表）。 */
export const MIGRATE_V1_TO_V2 = `
CREATE TABLE StockMovement_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('IN','OUT','TRANSFER','DAMAGE','ADJUSTMENT','REVERSAL')),
  productId INTEGER NOT NULL REFERENCES Product(id),
  batchId INTEGER NOT NULL REFERENCES Batch(id),
  fromLocationId INTEGER REFERENCES Location(id),
  toLocationId INTEGER REFERENCES Location(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  fromBeforeQty INTEGER, fromAfterQty INTEGER, toBeforeQty INTEGER, toAfterQty INTEGER,
  productNameSnapshot TEXT NOT NULL,
  locationCodeSnapshot TEXT NOT NULL,
  reason TEXT,
  referenceType TEXT,
  referenceId INTEGER,
  operatorId INTEGER NOT NULL REFERENCES User(id),
  createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  reversalOfId INTEGER UNIQUE REFERENCES StockMovement(id),
  reversalReason TEXT
);
INSERT INTO StockMovement_v2 (id, type, productId, batchId, fromLocationId, toLocationId, quantity, fromBeforeQty, fromAfterQty, toBeforeQty, toAfterQty, productNameSnapshot, locationCodeSnapshot, reason, referenceType, referenceId, operatorId, createdAt)
  SELECT id, type, productId, batchId, fromLocationId, toLocationId, quantity, fromBeforeQty, fromAfterQty, toBeforeQty, toAfterQty, productNameSnapshot, locationCodeSnapshot, reason, referenceType, referenceId, operatorId, createdAt FROM StockMovement;
DROP TABLE StockMovement;
ALTER TABLE StockMovement_v2 RENAME TO StockMovement;
CREATE INDEX IF NOT EXISTS Movement_type_time ON StockMovement(type, createdAt);
CREATE INDEX IF NOT EXISTS Movement_product ON StockMovement(productId);
CREATE INDEX IF NOT EXISTS Movement_batch ON StockMovement(batchId);
UPDATE meta SET value = '2' WHERE key = 'schemaVersion';
`;

/** 所有遷移跑完之後才建立的索引（依賴新欄位）。 */
export const POST_MIGRATION_SQL = `CREATE INDEX IF NOT EXISTS Batch_product_received ON Batch(productId, receivedAt);`;

/** v5 → v6：盤點附帶報損（StocktakeDamage 是新表，SCHEMA_SQL 已建立；這裡只更新版本號）。 */
export const MIGRATE_V5_TO_V6 = `
UPDATE meta SET value = '6' WHERE key = 'schemaVersion';
`;

/**
 * v4 → v5：批次加上精確的進貨時間（出庫改為先進先出）。
 * 舊資料：當天建立的批次用建立時間；補登／示範資料不知道幾點，一律記為當天 08:00（台灣時間）。
 */
export const MIGRATE_V4_TO_V5 = `
ALTER TABLE Batch ADD COLUMN receivedAt TEXT;
UPDATE Batch SET receivedAt = CASE
  WHEN date(createdAt, '+8 hours') = receivedDate THEN createdAt
  ELSE receivedDate || 'T00:00:00.000Z' END;
CREATE INDEX IF NOT EXISTS Batch_product_received ON Batch(productId, receivedAt);
UPDATE meta SET value = '5' WHERE key = 'schemaVersion';
`;

/** v3 → v4：盤點差異原因（腐爛／損壞、找不到、其他＋備註）。 */
export const MIGRATE_V3_TO_V4 = `
ALTER TABLE StocktakeItem ADD COLUMN reasonCode TEXT;
ALTER TABLE StocktakeItem ADD COLUMN reasonNote TEXT;
UPDATE meta SET value = '4' WHERE key = 'schemaVersion';
`;

/** v2 → v3：防重送識別碼綁定請求內容（審查 #5）。 */
export const MIGRATE_V2_TO_V3 = `
ALTER TABLE IdempotencyKey ADD COLUMN requestFingerprint TEXT;
UPDATE meta SET value = '3' WHERE key = 'schemaVersion';
`;
