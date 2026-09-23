/**
 * 資料表定義（對應 docs/DATABASE_DESIGN.md）。
 * 在 Durable Object 的 SQLite 內執行；Inventory.quantity 的 CHECK 是最後防線。
 */
export const SCHEMA_VERSION = 1;

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
  expiryDate TEXT NOT NULL,
  initialQty INTEGER NOT NULL CHECK (initialQty > 0),
  note TEXT,
  createdById INTEGER NOT NULL REFERENCES User(id),
  createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS Batch_product_expiry ON Batch(productId, expiryDate);

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
  type TEXT NOT NULL CHECK (type IN ('IN','OUT','TRANSFER','DAMAGE','ADJUSTMENT')),
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
  createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
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
  UNIQUE (stocktakeId, locationId, batchId)
);

CREATE TABLE IF NOT EXISTS IdempotencyKey (
  key TEXT PRIMARY KEY,
  userId INTEGER NOT NULL REFERENCES User(id),
  responseJson TEXT NOT NULL,
  createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS PairAttempt (clientKey TEXT PRIMARY KEY, attempts INTEGER NOT NULL, windowStart INTEGER NOT NULL);
`;
