# 技術設計文件（TECHNICAL_DESIGN.md）

專案：竹南冷凍倉儲庫存管理系統｜版本：v0.1（Stage 0）｜日期：2026-09-23
依據：`docs/PRD.md` v1.0、`docs/REQUIREMENTS_DECISIONS.md`

> 本文件是技術設計，不代表功能已完成。凡與 PRD 衝突處以 PRD 為準；本文件新增的「技術決策」若涉及產品行為，列於 §10 待確認事項，未經確認前視為預設方案。

---

## 1. 技術選型與評估

### 1.1 採用的技術組合

| 項目 | 技術 | 版本策略 | 評估結論 |
|---|---|---|---|
| 前端 | React 18 + TypeScript | 穩定版 | 採用。生態成熟、與 Konva 整合良好 |
| 建置 | Vite | 5.x | 採用。啟動快、設定少 |
| UI | Tailwind CSS | 4.x（`@tailwindcss/vite`） | 採用。免額外 PostCSS 設定，響應式（NFR-02）方便 |
| 平面圖 | React Konva（Konva） | 18.x | 採用。Canvas 拖曳、群組、命中測試皆內建，適合貨架／儲位拖曳 |
| 路由 | React Router | 6.x | 採用（PRD 11 個頁面需要路由） |
| 資料抓取 | TanStack Query | 5.x | 採用。快取＋失效簡化庫存操作後的重新整理 |
| 後端 | Node.js 22 + Express | Express 4.x | 採用。課程指定；Node 22 已確認安裝 |
| 驗證 | Zod | 3.x | 採用。API 輸入驗證，同一 schema 可前後端共用 |
| ORM | Prisma | 6.x | 採用（見 1.2 風險） |
| 資料庫 | SQLite | 檔案 `server/prisma/dev.db` | 採用。本機展示零部署成本；持久化即檔案（NFR-03） |
| 密碼雜湊 | bcryptjs | 純 JS | 採用，避免 Windows 原生模組編譯問題 |
| 認證 | JWT（httpOnly cookie） | jsonwebtoken | 採用。無需 session store |
| 單元／整合測試 | Vitest | 2.x | 採用 |
| API 測試 | Supertest | 7.x | 採用，直接對 Express app 測試（不需啟動 port） |
| E2E 測試 | Playwright | 1.x | 採用，Stage 5 導入 |
| 版本管理 | Git | 已初始化 `main` | 採用 |

### 1.2 主要風險與對策

| 風險 | 說明 | 對策 |
|---|---|---|
| Prisma + SQLite 並發 | SQLite 單寫入者；Prisma 互動式交易在 SQLite 上會序列化寫入，若交易過長會收到 `SQLITE_BUSY` | (1) 所有庫存交易走單一 `stockService`，交易內只做必要查詢與寫入；(2) 設定 `busy_timeout`（連線字串 `?connection_limit=1&socket_timeout=…`）；(3) 加 `PRAGMA journal_mode=WAL`；(4) 測試以 Vitest 並發送出同一儲位的多筆出庫驗證不會負數 |
| Prisma 不支援 CHECK 約束（schema 層） | `quantity >= 0` 無法在 schema.prisma 宣告 | 以自訂 migration SQL 加入 `CHECK(quantity >= 0)`；同時服務層先檢查，DB 約束作為最後防線 |
| React Konva 觸控與縮放 | 手機（NFR-02）需要平面圖平移／縮放 | Stage 3 實作 Stage 可拖曳（pan）＋按鈕縮放；拖曳貨架時關閉 stage draggable |
| 時程（10/2 展示） | 5 個 Stage 需在約一週內完成 | 嚴格依 P0→P1→P2 順序；每 Stage 結束都能獨立展示 |

### 1.3 曾評估但不採用的替代方案

| 方案 | 不採用原因 |
|---|---|
| better-sqlite3 + Drizzle | 同步交易對完整性更直觀，但偏離課程指定 Prisma，且 Windows 需編譯原生模組 |
| Next.js 全端 | 增加框架複雜度，對 Konva SSR 需額外處理；Vite + Express 分離更易說明前後端職責 |
| PostgreSQL | 展示需本機零安裝；SQLite 已足夠。若日後部署再以 Prisma 切換 provider |

---

## 2. 系統架構

```
┌────────────────────────────┐        HTTP/JSON (REST)        ┌──────────────────────────────┐
│  web/  (Vite + React)      │  ───────────────────────────▶  │  server/ (Express)           │
│  - pages/  (11 個頁面)      │  cookie: token (httpOnly JWT)  │  - routes/     解析請求、驗證輸入 │
│  - features/floorplan      │  ◀───────────────────────────  │  - services/   業務規則、交易     │
│    (React Konva)           │        4xx 帶 code+message     │  - middleware/ auth, role, error │
│  - api/ (TanStack Query)   │                                │  - prisma/     schema + migrations│
└────────────────────────────┘                                └──────────────┬───────────────┘
                                                                             │ Prisma Client
                                                                             ▼
                                                                    SQLite  server/prisma/dev.db
```

### 2.1 目錄結構（npm workspaces）

```
zhunan-cold-storage/
├─ AGENTS.md
├─ docs/                     PRD、技術設計、資料庫設計、測試計畫、實作計畫
├─ package.json              workspaces: server, web；root scripts: dev / test / build
├─ server/
│  ├─ prisma/schema.prisma   資料模型（Stage 1）
│  ├─ prisma/migrations/     含手寫 CHECK 約束 SQL
│  ├─ prisma/seed.ts         示範資料（兩座冷凍庫、示意貨架、20 種蔬果、admin/staff 帳號）
│  └─ src/
│     ├─ app.ts              建立 Express app（供 Supertest 使用）
│     ├─ index.ts            listen
│     ├─ config.ts
│     ├─ middleware/         auth.ts（JWT）、requireRole.ts、errorHandler.ts、idempotency.ts
│     ├─ routes/             auth、users、products、batches、warehouses、layout、inventory、stock、stocktakes、movements、dashboard、search
│     ├─ services/           productService、batchService、layoutService、stockService（IN/OUT/TRANSFER/DAMAGE）、stocktakeService、fefoService
│     ├─ lib/                prisma.ts、errors.ts（AppError）、batchNumber.ts
│     └─ __tests__/          Vitest + Supertest
└─ web/
   └─ src/
      ├─ api/                fetch 封裝與 hooks
      ├─ components/         共用 UI
      ├─ features/floorplan/ Konva 平面圖（檢視模式／編輯模式）
      ├─ pages/              Login, Dashboard, Products, Inventory, Floorplan, Inbound, Outbound, Damage, Stocktake, Movements, Settings
      └─ routes.tsx
```

### 2.2 前後端職責

| 職責 | 前端 | 後端 |
|---|---|---|
| 表單即時提示（分配合計、剩餘容量預覽） | ✓（體驗） | ✓（最終裁決） |
| 單一商品儲位、容量、負庫存、超額出庫 | 只顯示 | **必須**（交易內） |
| 角色權限（核准盤點、使用者管理） | 隱藏按鈕 | **必須**（`requireRole('ADMIN')`） |
| FEFO 建議 | 顯示、允許改選 | 計算並回傳建議清單 |
| 批次編號 | 顯示 | 產生（交易內，唯一） |
| 平面圖幾何（座標、拖曳） | 編輯與預覽 | 儲存、邊界驗證；**不觸碰庫存** |
| 重複提交防護 | 送出後鎖定按鈕、附 `Idempotency-Key` | 以 key 去重（見 §5.3） |

---

## 3. 認證與授權

- 登入 `POST /api/auth/login`（帳號＋密碼）→ 驗證 bcrypt → 簽發 JWT（payload：`userId`, `role`；有效 12 小時）→ 寫入 `httpOnly; SameSite=Lax` cookie `token`。
- `GET /api/auth/me` 回傳目前使用者；`POST /api/auth/logout` 清 cookie。
- `auth` middleware：無效／缺少 token → `401 UNAUTHENTICATED`。
- `requireRole('ADMIN')`：角色不符 → `403 FORBIDDEN`。套用於：盤點核准／退回、使用者 CRUD。
- 所有寫入 API 都要求登入；`operatorId` 一律取自 token，不接受 body 傳入。
- 密碼以 bcryptjs（cost 10）雜湊；種子帳號 `admin / admin1234`、`staff / staff1234`（僅供展示，README 標明）。
- 帳號建立：只有管理員可經 `POST /api/users` 建立，無自助註冊（PRD §10 待確認項目之技術預設）。

---

## 4. API 設計

### 4.1 通用慣例

- 前綴 `/api`；JSON；日期為 ISO 8601（`YYYY-MM-DD` 用於到期日／入庫日）。
- 數量欄位一律為 **正整數**（`quantity > 0`），小數單位（如公斤）於 §10 待確認；預設先以整數實作。
- 成功回傳 `200/201` 與資料本體；列表回傳 `{ items, total }`。
- 錯誤回傳：

```json
{ "error": { "code": "CAPACITY_EXCEEDED", "message": "儲位 A-01-02 對商品「甘藍菜」容量 20 籠，目前 15 籠，本次 10 籠會超過容量。", "details": { "locationCode": "A-01-02", "capacity": 20, "current": 15, "requested": 10 } } }
```

### 4.2 錯誤碼（NFR-07 要求可理解訊息）

| HTTP | code | 情境 |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Zod 驗證失敗（欄位在 details） |
| 401 | `UNAUTHENTICATED` | 未登入 |
| 403 | `FORBIDDEN` | 角色不足 |
| 404 | `NOT_FOUND` | 資源不存在 |
| 409 | `ALLOCATION_MISMATCH` | 分配合計 ≠ 入庫量（AT-04） |
| 409 | `CAPACITY_EXCEEDED` | 超容量（AT-05, AT-14） |
| 409 | `LOCATION_PRODUCT_CONFLICT` | 儲位已有其他商品（AT-06, AT-14） |
| 409 | `INSUFFICIENT_STOCK` | 出庫／報損／搬移超過可用量（AT-12, AT-20） |
| 409 | `LOCATION_NOT_EMPTY` | 刪除有庫存儲位／貨架（AT-17） |
| 409 | `STOCKTAKE_CONFLICT` | 核准時基準量 ≠ 目前量（AT-24） |
| 409 | `STOCKTAKE_NOT_PENDING` | 已核准／退回的盤點再操作 |
| 409 | `CAPACITY_BELOW_OCCUPIED` | 修改容量低於目前占用（FR-007） |
| 409 | `UNIT_LOCKED` | 已有批次的商品修改單位 |
| 409 | `DUPLICATE_REQUEST` | Idempotency-Key 重複 |
| 409 | `CONCURRENT_UPDATE` | 版本衝突（樂觀鎖） |
| 500 | `INTERNAL_ERROR` | 其他 |

### 4.3 端點一覽

| 方法 | 路徑 | 角色 | 說明 |
|---|---|---|---|
| POST | `/api/auth/login` | 公開 | 登入 |
| POST | `/api/auth/logout` | 登入 | 登出 |
| GET | `/api/auth/me` | 登入 | 目前使用者 |
| GET/POST | `/api/users`, PATCH `/api/users/:id` | ADMIN | 使用者管理（FR-001） |
| GET/POST | `/api/products`, GET/PATCH `/api/products/:id` | 登入 | 商品 CRUD＋停用（FR-002）；`?q=` 搜尋、`?includeInactive=` |
| GET | `/api/products/:id/stock` | 登入 | 商品可用總量、各批次、各儲位明細 |
| GET | `/api/batches`, `/api/batches/:id` | 登入 | 批次查詢（FR-003） |
| GET | `/api/warehouses` | 登入 | 兩座冷凍庫＋布局摘要 |
| GET | `/api/warehouses/:id/layout` | 登入 | 完整布局：racks、locations（含幾何、占用狀態） |
| PUT | `/api/warehouses/:id/layout` | 登入 | 儲存整份布局（新增／移動／更名貨架與儲位）；不影響庫存（FR-005） |
| DELETE | `/api/locations/:id`、`/api/racks/:id` | 登入 | 刪除；有庫存 → 409（FR-005） |
| GET/PUT | `/api/locations/:id/capacities` | 登入 | 儲位×商品容量（FR-007） |
| GET | `/api/locations/:id` | 登入 | 儲位詳情：目前商品、各批次數量、容量 |
| POST | `/api/stock/inbound` | 登入 | 入庫（多儲位分配）（FR-008~010） |
| POST | `/api/stock/outbound/suggest` | 登入 | FEFO 建議（FR-012） |
| POST | `/api/stock/outbound` | 登入 | 出庫（指定批次＋儲位明細）（FR-011） |
| POST | `/api/stock/transfer` | 登入 | 部分搬移（FR-013） |
| POST | `/api/stock/damage` | 登入 | 直接報損（FR-014） |
| GET/POST | `/api/stocktakes`, GET `/api/stocktakes/:id` | 登入 | 盤點提交／查詢（FR-015） |
| POST | `/api/stocktakes/:id/approve`、`/reject` | **ADMIN** | 核准／退回 |
| GET | `/api/movements` | 登入 | 異動紀錄，篩選 type/product/batch/location/date（FR-016） |
| GET | `/api/dashboard` | 登入 | 統計、效期提醒、低庫存提醒（FR-017/018） |
| GET | `/api/search?q=` | 登入 | 商品名／批次號／儲位號 → 匹配清單與位置（FR-019） |
| GET | `/api/health` | 公開 | 健康檢查 |

### 4.4 核心請求格式

**入庫** `POST /api/stock/inbound`（Header `Idempotency-Key: <uuid>`）
```json
{ "productId": 3, "quantity": 30, "expiryDate": "2027-03-01", "receivedDate": "2026-09-23", "note": "",
  "allocations": [ { "locationId": 12, "quantity": 20 }, { "locationId": 15, "quantity": 10 } ] }
```
回傳：`{ batch: {id, batchNo,...}, inventories: [...], movements: [...] }`

**FEFO 建議** `POST /api/stock/outbound/suggest` `{ productId, quantity }` →
`{ suggestions: [ { batchId, batchNo, expiryDate, locationId, locationCode, available, take } ], shortage: 0 }`
排序：到期日升冪 → 同日者依入庫日期升冪 → 再依儲位編號；已過期批次仍列入但標記 `expired: true` 並置頂提示（§10 待確認）。

**出庫** `POST /api/stock/outbound` `{ productId, lines: [ { batchId, locationId, quantity } ], note }`

**搬移** `POST /api/stock/transfer` `{ batchId, fromLocationId, toLocationId, quantity, note }`

**報損** `POST /api/stock/damage` `{ batchId, locationId, quantity, reason }`

**盤點提交** `POST /api/stocktakes` `{ warehouseId?, items: [ { locationId, batchId, countedQty } ], note }` → 後端自動填入每筆 `systemQty`（提交當下庫存）與 `diff`。

**核准** `POST /api/stocktakes/:id/approve` → 逐筆比對 `systemQty` 與目前庫存；任一不符 → `409 STOCKTAKE_CONFLICT`（回傳衝突明細），全部相符才寫入 ADJUSTMENT 並更新庫存。

---

## 5. 庫存交易設計（資料完整性核心）

### 5.1 單一入口原則

所有改變 `Inventory.quantity` 的邏輯只存在於 `server/src/services/stockService.ts`，每個操作都是：

```
prisma.$transaction(async (tx) => {
  1. 讀取並鎖定相關 Inventory / Location / Capacity（SQLite 交易期間即持有寫鎖）
  2. 執行業務驗證（拋 AppError → 整筆 rollback）
  3. 更新 Inventory（使用 updateMany + where quantity >= n 條件，影響筆數 0 → 拋 INSUFFICIENT_STOCK）
  4. 寫入 StockMovement（每儲位一筆，含 beforeQty/afterQty）
  5. 寫入 IdempotencyKey
}, { timeout: 10_000 })
```

任一步驟失敗 → 交易回滾 → 庫存與紀錄「同時失敗」（PRD 不變量／NFR-05）。

### 5.2 各操作的驗證清單

| 操作 | 驗證（皆在交易內） |
|---|---|
| IN | 商品存在且啟用；quantity>0；`Σ allocations = quantity`；每儲位：儲位啟用、儲位為空或現有商品＝本商品、`current + alloc ≤ capacity`；批次號唯一 |
| OUT | 每 line：Inventory(batch, location) 存在且 `quantity ≥ line.quantity`；lines 內同 (batch, location) 不可重複 |
| TRANSFER | 來源 ≥ quantity；目的儲位商品相容；目的容量足夠；來源≠目的；成功後 `Σ 商品量` 不變（測試斷言） |
| DAMAGE | Inventory ≥ quantity；reason 必填 |
| ADJUSTMENT | 只由盤點核准產生；每筆 `systemQty == current`；調整後不得 <0 |

### 5.3 重複提交防護

- 前端每次送出產生 UUID 放在 `Idempotency-Key` header，送出中鎖定按鈕。
- 後端 `IdempotencyKey(key UNIQUE, userId, responseJson, createdAt)`：同 key 第二次 → 直接回傳第一次的結果（或 `409 DUPLICATE_REQUEST`，§10 待確認；預設回傳原結果）。寫入與庫存更新在同一交易內，確保「要嘛全做、要嘛全沒做」。

### 5.4 並發控制

- SQLite 同一時間只有一個寫交易；Prisma 互動式交易搭配 `busy_timeout` 讓後到的交易等待而非失敗。
- 扣庫存採條件更新：`UPDATE Inventory SET quantity = quantity - ? WHERE id = ? AND quantity >= ?`，用 affected rows 判斷，避免「讀後寫」競爭。
- DB 層 `CHECK (quantity >= 0)` 為最後防線。
- 盤點核准以 `systemQty` 作樂觀鎖基準（AT-24）。
- 布局儲存以 `Warehouse.layoutVersion` 樂觀鎖：PUT 需帶 `version`，不符 → `409 CONCURRENT_UPDATE`。

### 5.5 批次編號

格式 `B{YYYYMMDD}-{NNN}`（例 `B20260923-001`），交易內以 `BatchCounter(date, seq)` 表 upsert 取號，DB 上 `Batch.batchNo UNIQUE`（AT-02）。

---

## 6. 平面圖（FR-005）設計

- 座標系：每座冷凍庫有 `width × height`（單位：公分，示範值 1200×800，可編輯）；前端 Konva Stage 以比例縮放。
- `Rack`：`x, y, width, height, rotation(0/90), label`；`Location`：相對貨架的 `x, y, width, height`＋`code`（如 `A-01-02` = 倉庫-貨架-儲位）。
- 固定圖元：倉庫邊界、入口、通道以 `Warehouse.layoutJson`（唯讀示範資料，Stage 3 可編輯）描述。
- 檢視模式：點儲位 → 側欄顯示商品／批次／數量與「入庫／出庫／搬移」按鈕；搜尋結果高亮（AT-10）。
- 編輯模式：新增貨架（含預設 N 個儲位）、新增儲位、拖曳（Konva `draggable`）、儲存。儲存呼叫 `PUT /layout`，後端只驗證：座標在倉庫邊界內、儲位在貨架內、代碼唯一；**重疊只在前端警告，不阻擋**（§10 待確認）。
- 幾何更新絕不觸碰 `Inventory`／`StockMovement`（AT-16）。
- 刪除：儲位有庫存 → 409；貨架下任一儲位有庫存 → 409；否則軟刪除（`status = ARCHIVED`）以保留歷史紀錄的可追溯（FR-016）。

---

## 7. 前端設計

- 頁面對應 PRD §4；`/login` 以外全部受 `RequireAuth` 保護；`Settings` 內使用者管理僅 ADMIN 可見（後端另擋）。
- 雙入口入庫／出庫共用同一個 `InboundForm`／`OutboundForm` 元件，僅初始值不同（從儲位入口帶入 `locationId`／`batchId`）。
- 每個庫存操作：確認摘要 → 送出 → 結果訊息（含批次號、各儲位變化）。
- 響應式：Tailwind 斷點；平面圖在手機以整寬顯示並可平移／縮放。
- 語言：繁體中文（NFR-01）。

---

## 8. 錯誤處理

- 後端：`AppError(code, status, message, details)`；`errorHandler` 統一轉為 §4.1 格式；Zod 錯誤轉 `VALIDATION_ERROR`；未知錯誤記 log 回 500，不外洩堆疊。
- 前端：API 層統一解析 `error.code`，表單顯示 `message`；401 導向登入。
- 交易內任何 AppError 皆 rollback（Prisma 互動式交易 throw 即回滾）。

---

## 9. 開發與執行

```bash
npm install                 # 安裝所有 workspace
npm run db:migrate          # server: prisma migrate dev
npm run db:seed             # 示範資料
npm run dev                 # 同時啟動 server(3001) 與 web(5173，proxy /api)
npm test                    # Vitest（server + web）
npm run test:e2e            # Playwright（Stage 5）
```

---

## 10. 待確認技術／產品問題（未確認前採「預設」）

| # | 問題 | 預設方案 |
|---|---|---|
| Q1 | 數量是否需要小數（公斤 0.5）？ | 先用整數；若需小數改為 `Decimal`／以最小單位整數存 |
| Q2 | 儲位尚未設定該商品容量時，入庫允許嗎？ | 儲位有 `defaultCapacity`（可為空＝不限制）；有 `LocationCapacity` 則以其為準 |
| Q3 | 修改容量低於占用量的互動？ | 直接拒絕 `409 CAPACITY_BELOW_OCCUPIED`，提示先搬移 |
| Q4 | 貨架／儲位重疊與越界 | 越界後端拒絕；重疊前端警告不阻擋 |
| Q5 | 刪除貨架時儲位處理 | 貨架及其下所有儲位皆無庫存才可刪；一併軟刪除 |
| Q6 | FEFO 遇已過期批次 | 仍列入建議並標記「已過期」置頂提醒，不自動排除 |
| Q7 | 重複 Idempotency-Key 回應 | 回傳第一次的結果（200），不視為錯誤 |
| Q8 | 已有批次的商品改單位 | 拒絕（`UNIT_LOCKED`）；改名允許，歷史紀錄用 productId 關聯故不受影響 |
| Q9 | 盤點衝突處理 | 核准整單拒絕並列出衝突項，需重新提交 |
| Q10 | 帳號建立 | 僅管理員建立；無註冊頁 |
| Q11 | 展示部署 | 本機執行為主；不做雲端部署 |
