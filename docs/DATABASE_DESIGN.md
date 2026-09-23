# 資料庫設計文件（DATABASE_DESIGN.md）

專案：竹南冷凍倉儲庫存管理系統｜版本：v0.1（Stage 0）｜日期：2026-09-23
資料庫：SQLite（Prisma 6）｜對應 PRD §5 概念資料模型

> 所有 `id` 為自增整數主鍵；所有表含 `createdAt`、`updatedAt`（DateTime）。日期型欄位（到期日、入庫日）以 `DateTime` 儲存、API 以 `YYYY-MM-DD` 交換。

> **v0.2 變更（2026-09-23）**：資料表改以 SQL 直接建立於 Durable Object SQLite（`worker/src/db/schema.ts`），欄位與約束同本文件；日期欄位改存 `YYYY-MM-DD` 文字、時間戳存 ISO 字串；新增 `PairAttempt`（配對節流）與 `meta`（schema 版本）表。`CHECK (quantity >= 0)` 直接寫在建表語句。


---

## 1. ER 關係總覽

```
User ──< StockMovement          Warehouse ──< Rack ──< Location ──< Inventory >── Batch >── Product
User ──< Stocktake(submitted/approved)                   │                                  │
Stocktake ──< StocktakeItem                              └──< LocationCapacity >────────────┘
BatchCounter（取號）   IdempotencyKey（去重）
```

- Warehouse 1:N Rack 1:N Location
- Product 1:N Batch 1:N Inventory；Location 1:N Inventory
- Inventory 唯一鍵 `(batchId, locationId)`：同批次可分散多儲位（FR-003）、同儲位可多批次（FR-006）
- LocationCapacity 唯一鍵 `(locationId, productId)`（FR-007）

---

## 2. 資料表定義

### 2.1 User
| 欄位 | 型別 | 約束 | 說明 |
|---|---|---|---|
| id | Int | PK | |
| username | String | UNIQUE | 帳號 |
| passwordHash | String | NOT NULL | bcrypt |
| displayName | String | NOT NULL | 顯示名稱 |
| role | Enum `ADMIN` / `STAFF` | NOT NULL | 角色 |
| status | Enum `ACTIVE` / `DISABLED` | default ACTIVE | 停用者不可登入 |

### 2.2 Product
| 欄位 | 型別 | 約束 | 說明 |
|---|---|---|---|
| id | Int | PK | |
| name | String | UNIQUE (active) | 商品名稱 |
| category | String | nullable | 類別 |
| unit | String | NOT NULL | 計量單位（籠／箱／公斤）；有批次後不可改 |
| lowStockThreshold | Int | default 0 | 低庫存警戒值（FR-018） |
| expiryAlertDays | Int | default 7 | 效期提醒天數（FR-018） |
| status | Enum `ACTIVE` / `INACTIVE` | default ACTIVE | 停用不刪除（保留歷史） |
| note | String | nullable | |

### 2.3 Batch
| 欄位 | 型別 | 約束 | 說明 |
|---|---|---|---|
| id | Int | PK | |
| batchNo | String | UNIQUE | `B20260923-001`（AT-02） |
| productId | Int | FK → Product | |
| receivedDate | DateTime | NOT NULL | 入庫日期 |
| expiryDate | DateTime | NOT NULL | 預計到期日（FEFO 排序鍵） |
| initialQty | Int | NOT NULL, >0 | 原始入庫量 |
| note | String | nullable | |
| createdById | Int | FK → User | |

索引：`(productId, expiryDate)`。

### 2.4 BatchCounter
| 欄位 | 型別 | 約束 |
|---|---|---|
| dateKey | String | PK（`20260923`） |
| seq | Int | default 0 |

在入庫交易內 `upsert` 後 +1 取號，配合 `Batch.batchNo UNIQUE` 保證唯一。

### 2.5 Warehouse
| 欄位 | 型別 | 約束 | 說明 |
|---|---|---|---|
| id | Int | PK | |
| code | String | UNIQUE | `A` / `B` |
| name | String | NOT NULL | 冷凍庫 A |
| width / height | Int | NOT NULL | 平面圖尺寸（示範值，可編輯） |
| layoutJson | String (JSON) | default `{}` | 入口、通道等固定圖元 |
| layoutVersion | Int | default 0 | 布局樂觀鎖 |

### 2.6 Rack
| 欄位 | 型別 | 約束 | 說明 |
|---|---|---|---|
| id | Int | PK | |
| warehouseId | Int | FK → Warehouse | |
| code | String | UNIQUE(warehouseId, code) | `01` |
| label | String | nullable | |
| x, y, width, height | Int | NOT NULL | 平面圖幾何 |
| rotation | Int | default 0 | 0 / 90 |
| status | Enum `ACTIVE` / `ARCHIVED` | default ACTIVE | 軟刪除 |

### 2.7 Location（儲位）
| 欄位 | 型別 | 約束 | 說明 |
|---|---|---|---|
| id | Int | PK | |
| rackId | Int | FK → Rack | |
| code | String | UNIQUE | 全域唯一，如 `A-01-02`（搜尋鍵，FR-019） |
| x, y, width, height | Int | NOT NULL | 相對貨架幾何 |
| defaultCapacity | Int | nullable | 未設商品容量時的預設；null＝不限制（待確認 Q2） |
| status | Enum `ACTIVE` / `ARCHIVED` | default ACTIVE | 軟刪除；有庫存不可刪（AT-17） |

> 「儲位目前商品」不存欄位，由 `Inventory` 中 quantity>0 的批次推導（唯一商品由交易驗證保證）。

### 2.8 LocationCapacity
| 欄位 | 型別 | 約束 |
|---|---|---|
| id | Int | PK |
| locationId | Int | FK → Location |
| productId | Int | FK → Product |
| capacity | Int | NOT NULL, >0 |
| | | UNIQUE(locationId, productId) |

### 2.9 Inventory（庫存明細）
| 欄位 | 型別 | 約束 | 說明 |
|---|---|---|---|
| id | Int | PK | |
| batchId | Int | FK → Batch | |
| locationId | Int | FK → Location | |
| quantity | Int | NOT NULL, **CHECK ≥ 0** | 目前可用數量 |
| | | UNIQUE(batchId, locationId) | |

- 商品可用總量 = `Σ Inventory.quantity` join Batch where productId。
- 儲位占用量（對商品）= `Σ Inventory.quantity` where locationId and batch.productId。
- quantity 歸零的列保留（或於交易末刪除），兩者皆須讓「儲位清空後可改存另一商品」成立；預設：**歸零即刪除**，避免幽靈占用。

### 2.10 StockMovement（異動紀錄，FR-016）
| 欄位 | 型別 | 約束 | 說明 |
|---|---|---|---|
| id | Int | PK | |
| type | Enum `IN` / `OUT` / `TRANSFER` / `DAMAGE` / `ADJUSTMENT` | NOT NULL | 五類 |
| productId | Int | FK → Product | 冗餘以利查詢 |
| batchId | Int | FK → Batch | |
| fromLocationId | Int | FK → Location, nullable | OUT/TRANSFER/DAMAGE/ADJ(-) |
| toLocationId | Int | FK → Location, nullable | IN/TRANSFER/ADJ(+) |
| quantity | Int | NOT NULL, >0 | |
| fromBeforeQty / fromAfterQty | Int | nullable | 來源儲位異動前後 |
| toBeforeQty / toAfterQty | Int | nullable | 目的儲位異動前後 |
| productNameSnapshot / locationCodeSnapshot | String | NOT NULL | 快照，改名後仍可追溯 |
| reason | String | nullable | 報損原因、盤點說明 |
| referenceType / referenceId | String / Int | nullable | 例如 `STOCKTAKE`, id；同一入庫的多筆共用 `referenceId = batchId` |
| operatorId | Int | FK → User | 由 token 取得 |
| createdAt | DateTime | | 操作時間 |

**紀錄不可修改／刪除**：不提供 UPDATE/DELETE API（P-06）。
索引：`(type, createdAt)`, `(productId)`, `(batchId)`, `(fromLocationId)`, `(toLocationId)`。

### 2.11 Stocktake / StocktakeItem（FR-015）
**Stocktake**
| 欄位 | 型別 | 說明 |
|---|---|---|
| id | Int PK | |
| status | Enum `PENDING` / `APPROVED` / `REJECTED` | |
| warehouseId | Int FK nullable | 範圍 |
| note | String nullable | |
| submittedById / submittedAt | FK User / DateTime | 提交 |
| reviewedById / reviewedAt / reviewNote | FK User nullable | 核准或退回 |

**StocktakeItem**
| 欄位 | 型別 | 說明 |
|---|---|---|
| id | Int PK | |
| stocktakeId | Int FK → Stocktake | |
| locationId | Int FK | |
| batchId | Int FK | |
| systemQty | Int | 提交當下庫存（核准時比對基準，AT-24） |
| countedQty | Int ≥ 0 | 實盤 |
| diff | Int | countedQty − systemQty |
| UNIQUE(stocktakeId, locationId, batchId) | | |

核准流程（交易內）：逐筆 `Inventory.quantity == systemQty` → 否則 409 全單拒絕；相符則更新為 `countedQty` 並寫 `ADJUSTMENT` 紀錄（quantity=|diff|，方向以 from/to 表示）。

### 2.12 IdempotencyKey
| 欄位 | 型別 |
|---|---|
| key | String PK（UUID） |
| userId | Int FK |
| responseJson | String |
| createdAt | DateTime |

---

## 3. 約束與不變量對照

| PRD 不變量 | 落實方式 |
|---|---|
| 庫存不得負數 | `CHECK(quantity >= 0)`（migration SQL）＋條件更新 `WHERE quantity >= ?` |
| 不可混放不同商品 | 交易內查詢儲位既有商品；不同 → `LOCATION_PRODUCT_CONFLICT` |
| 不可超容量 | 交易內 `current + delta ≤ capacity` |
| 搬移總量不變 | 同一交易內 `-n` / `+n`；測試斷言 Σ 不變 |
| 庫存與紀錄同一交易 | `prisma.$transaction` 互動式交易 |
| 盤點須核准 | 提交只寫 Stocktake/Item；`approve` 受 `requireRole('ADMIN')` |
| 批次唯一 | `Batch.batchNo UNIQUE` + BatchCounter |
| 不重複扣庫存 | IdempotencyKey PK |
| 歷史可追溯 | 軟刪除 + 快照欄位 + 無刪改 API |

---

## 4. 示範種子資料（seed，標示為模擬）

- 使用者：`admin`（ADMIN）、`staff`（STAFF）。
- 冷凍庫 A、B：各 1200×800，入口與一條主通道；A 有 4 座貨架 × 6 儲位、B 有 3 座 × 6 儲位（示意配置，可編輯）。
- 商品：約 20 種蔬果（甘藍菜／籠、高麗菜／籠、紅蘿蔔／箱、毛豆／公斤…），各自 unit、threshold、alertDays。
- 容量：每儲位對每商品預設 20（`defaultCapacity`）。
- 初始庫存：少量既有批次以呈現 Dashboard 提醒（含一筆即將到期）。
- 展示流程（AT 整合情境）由操作展示，不預先寫入。

---

## 5. Prisma schema 草稿（Stage 1 實作時定稿）

```prisma
enum Role { ADMIN STAFF }
enum MovementType { IN OUT TRANSFER DAMAGE ADJUSTMENT }
enum StocktakeStatus { PENDING APPROVED REJECTED }

model Inventory {
  id         Int      @id @default(autoincrement())
  batchId    Int
  locationId Int
  quantity   Int
  batch      Batch    @relation(fields: [batchId], references: [id])
  location   Location @relation(fields: [locationId], references: [id])
  @@unique([batchId, locationId])
  @@index([locationId])
}
// 其餘模型依 §2 表格；CHECK 約束於 migration.sql 手動追加：
// ALTER TABLE "Inventory" ... 因 SQLite 不支援 ADD CONSTRAINT，於建表 migration 內直接寫入
// CREATE TABLE "Inventory" (..., "quantity" INTEGER NOT NULL CHECK ("quantity" >= 0), ...)
```
