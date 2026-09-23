# 實作計畫（IMPLEMENTATION_PLAN.md）

專案：竹南冷凍倉儲庫存管理系統｜日期：2026-09-23｜目標：2026-10-02 展示
每個 Stage 可獨立測試與展示；完成後建立 Git commit；未經指示不進入下一 Stage。

---

## Stage 0：環境、Git、AGENTS.md、技術文件 ✅（本次）

| 項目 | 內容 |
|---|---|
| 開發目標 | 建立可協作的專案骨架與設計基準 |
| 實作功能 | Git 初始化；npm workspaces（server／web）；Express + Vitest + Supertest 健康檢查測試；Vite + React + Tailwind 空白頁；Prisma 安裝；設計文件五份；AGENTS.md |
| 涉及檔案 | `AGENTS.md`, `README.md`, `.gitignore`, `package.json`, `server/**`, `web/**`, `docs/*.md` |
| 測試項目 | `npm test`（server health 測試）、`npm run build`（web）、`tsc --noEmit` |
| 完成標準 | 上述指令通過；首次 commit；文件齊全 |
| 可能風險 | Windows 路徑／中文檔名編碼；Tailwind v4 與 Vite 版本相容 |

## Stage 1：資料庫、商品、批次、庫存模型（P0）

| 項目 | 內容 |
|---|---|
| 開發目標 | 完成資料模型、登入、商品 CRUD、批次與庫存查詢、搜尋 |
| 實作功能 | Prisma schema 全部模型＋CHECK 約束 migration；seed（帳號、兩座冷凍庫、示意貨架儲位、20 種商品）；JWT 登入／登出／me；`requireRole`；商品 CRUD 與停用、單位鎖定；批次查詢；商品庫存明細；`/search`；`/warehouses/:id/layout`（唯讀） |
| 涉及檔案 | `server/prisma/schema.prisma`, `migrations/`, `seed.ts`, `src/middleware/*`, `src/routes/{auth,users,products,batches,warehouses,search}.ts`, `src/services/{productService,searchService}.ts`, 對應測試 |
| 測試項目 | AT-01、AT-09（API）、I-5、I-6；商品單位鎖定；停用商品不可入庫（預備） |
| 完成標準 | migrate + seed 可重複執行；測試全綠；API 可用 curl 走完登入→新增商品→搜尋 |
| 可能風險 | Prisma migration 手寫 CHECK 與 `prisma migrate dev` 漂移；日期時區（統一 UTC 日期字串） |

## Stage 2：入庫、出庫、搬移、報損（P0/P1 核心交易）

| 項目 | 內容 |
|---|---|
| 開發目標 | 所有庫存異動走單一交易服務，滿足全部完整性規則 |
| 實作功能 | `stockService`：inbound（多儲位分配、批次取號）、outbound + FEFO suggest、transfer、damage；容量（LocationCapacity CRUD）；Idempotency middleware；`/movements` 查詢；儲位詳情 |
| 涉及檔案 | `src/services/{stockService,fefoService,capacityService}.ts`, `src/lib/batchNumber.ts`, `src/middleware/idempotency.ts`, `src/routes/{stock,locations,movements}.ts`, 測試 |
| 測試項目 | AT-02～AT-07、AT-11～AT-14、AT-19、AT-20、AT-25（API 部分）；I-1～I-4、I-7 前置、I-8 |
| 完成標準 | 以 API 可跑完「30→搬 5→出 10→損 3＝17」；並發測試通過 |
| 可能風險 | SQLite busy；並發測試在 Windows 上不穩定 → 加 busy_timeout、交易縮短 |

## Stage 3：可編輯 2D 倉庫平面圖（P1）

| 項目 | 內容 |
|---|---|
| 開發目標 | 兩座冷凍庫平面圖：檢視模式（點選儲位、狀態顏色）與編輯模式（新增／拖曳／刪除／儲存） |
| 實作功能 | 前端 `features/floorplan`（Konva Stage、Rack/Location 圖元、拖曳、縮放平移、狀態色）；後端 `PUT /layout`（邊界驗證、樂觀鎖、軟刪除檢查）；儲位側欄（商品／批次／數量、入庫／出庫／搬移入口按鈕，Stage 4 接表單） |
| 涉及檔案 | `web/src/features/floorplan/**`, `web/src/pages/Floorplan.tsx`, `server/src/services/layoutService.ts`, `src/routes/layout.ts`, 測試 |
| 測試項目 | AT-15、AT-16、AT-17（API）；I-7；前端拖曳 E2E 先做 smoke |
| 完成標準 | staff 可新增貨架、拖曳後儲存、重新整理位置保留；有庫存儲位刪除被拒 |
| 可能風險 | Konva 在手機觸控與 Stage 拖曳衝突；效能（儲位數 < 200 無虞） |

## Stage 4：Dashboard、盤點、權限與完整介面（P2）

| 項目 | 內容 |
|---|---|
| 開發目標 | 11 個頁面全部可操作，雙入口入出庫接上平面圖 |
| 實作功能 | 登入頁與路由守衛；Dashboard（依單位分組統計、效期／低庫存提醒、快捷入口）；商品管理頁；庫存查詢／搜尋定位（高亮）；快速入庫／出庫頁與從儲位入口共用表單（含流程中新增商品）；報損頁；盤點提交／核准／退回（後端 stocktakeService）；異動紀錄頁篩選；系統設定（使用者管理） |
| 涉及檔案 | `web/src/pages/**`, `web/src/api/**`, `server/src/services/{stocktakeService,dashboardService}.ts`, `src/routes/{stocktakes,dashboard,users}.ts`, 測試 |
| 測試項目 | AT-10、AT-18、AT-21～AT-24；前端表單測試（AT-04 提示、按鈕鎖定） |
| 完成標準 | 以 UI 走完整合展示情境；staff 看不到也呼叫不了核准 |
| 可能風險 | 頁面數多、時程緊 → 優先展示流程用到的頁面，設定頁最後 |

## Stage 5：自動測試、人工驗證與展示準備

| 項目 | 內容 |
|---|---|
| 開發目標 | E2E 覆蓋展示情境；人工驗證紀錄；展示備援 |
| 實作功能 | Playwright 設定與 `e2e/` 情境（登入、整合情境、拖曳、權限、手機 viewport）；`docs/MANUAL_VERIFICATION.md` 檢查表與結果；展示用 seed 重置腳本 `npm run demo:reset`；README 執行指南；截圖／錄影備援 |
| 涉及檔案 | `playwright.config.ts`, `e2e/*.spec.ts`, `docs/MANUAL_VERIFICATION.md`, `server/prisma/seed.ts`, `README.md` |
| 測試項目 | 全部 AT；NFR-02 手機；I-1～I-8 回歸 |
| 完成標準 | `npm test` 與 `npm run test:e2e` 全綠並附報告；人工驗證表填寫完畢；未完成項目如實列出 |
| 可能風險 | Playwright 瀏覽器下載時間；展示當天網路 → 全部本機執行 |

---

## 時程建議（至 10/2）

| 日期 | Stage |
|---|---|
| 9/23 | Stage 0 |
| 9/24 | Stage 1 |
| 9/25–9/26 | Stage 2 |
| 9/27–9/28 | Stage 3 |
| 9/29–9/30 | Stage 4（9/30 課堂討論可展示 API + 平面圖） |
| 10/1 | Stage 5、演練 |
| 10/2 | 展示 |
