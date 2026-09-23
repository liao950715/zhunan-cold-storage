# 測試計畫（TEST_PLAN.md）

專案：竹南冷凍倉儲庫存管理系統｜版本：v0.1（Stage 0）｜日期：2026-09-23
依據：PRD §7 驗收標準（AT-01～AT-25）、§6 非功能需求

> 原則：**未實際執行的測試不得宣稱通過**。每個 Stage 交付時附上實際測試指令與輸出摘要。

---

## 1. 測試層級與工具

| 層級 | 工具 | 範圍 | 位置 |
|---|---|---|---|
| 單元測試 | Vitest | 純函式：FEFO 排序、批次編號格式、分配合計驗證、Zod schema | `server/src/**/*.test.ts` |
| 整合／API 測試 | Vitest + Supertest + 測試用 SQLite | 每個 API 端點的成功／失敗路徑、交易回滾、權限、並發 | `server/src/__tests__/*.test.ts` |
| 前端元件測試 | Vitest + Testing Library | 表單驗證提示（分配合計、按鈕鎖定） | `web/src/**/*.test.tsx` |
| E2E | Playwright | PRD 整合展示情境、平面圖拖曳、權限 | `e2e/*.spec.ts` |
| 人工驗證 | 檢查表 | NFR-01/02、展示流程演練 | `docs/MANUAL_VERIFICATION.md`（Stage 5 建立） |

測試資料庫：每個測試檔使用獨立 SQLite 檔（`file:./test-<name>.db`）並在 `beforeAll` 執行 migrate + 最小 seed，`afterAll` 刪除。

---

## 2. 驗收條件 → 測試對照

### 2.1 商品／入庫／搜尋

| AT | 情境 | 測試層級 | 測試內容 | Stage |
|---|---|---|---|---|
| AT-01 | 工作人員登入／新增商品 | API, E2E | staff 登入 200；POST /products 201；未登入 401 | 1 |
| AT-02 | 同日連續入庫批次唯一 | API | 同日 3 次入庫 → 3 個不同 batchNo，格式 `B\d{8}-\d{3}`；並發 10 次入庫仍唯一 | 1/2 |
| AT-03 | 30 籠分兩儲位 | API | allocations 20+10 → 兩筆 Inventory，各儲位正確，商品總量 30 | 2 |
| AT-04 | 分配合計≠總量 | API, 前端 | 20+5≠30 → 409 `ALLOCATION_MISMATCH`；前端提交按鈕停用 | 2 |
| AT-05 | 入庫超容量無部分更新 | API | 第二儲位超容量 → 409 `CAPACITY_EXCEEDED`；**第一儲位庫存、Batch、Movement 皆未寫入** | 2 |
| AT-06 | 不同商品放入已有貨儲位 | API | → 409 `LOCATION_PRODUCT_CONFLICT`，庫存不變 | 2 |
| AT-07 | 同商品不同批次共用儲位 | API | 兩批入同儲位 → 儲位詳情列出兩批次各自數量 | 2 |
| AT-08 | 重新整理後資料仍在 | E2E | 入庫、拖曳後 reload，庫存與位置一致 | 3/5 |
| AT-09 | 搜尋商品／批次／儲位 | API, E2E | `/search?q=甘藍菜` 回傳全部批次、數量、儲位；批次號與儲位號搜尋亦然 | 1/4 |
| AT-10 | 點搜尋結果高亮 | E2E | 點結果 → 切換到對應冷凍庫、相關儲位帶高亮 class | 4 |

### 2.2 出庫／搬移／平面圖

| AT | 情境 | 測試層級 | 測試內容 | Stage |
|---|---|---|---|---|
| AT-11 | 多批次出庫 FEFO | 單元, API, E2E | suggest 回傳依到期日升冪；改選其他批次後 outbound 依指定 lines 扣減 | 2 |
| AT-12 | 超額出庫 | API | 可用 10 出 11 → 409 `INSUFFICIENT_STOCK`；庫存與紀錄不變；多 lines 其中一筆超額 → 全部回滾 | 2 |
| AT-13 | 部分搬移 | API | 20→搬 5 → 來源 15、目的 5、Σ 不變；TRANSFER 紀錄含 from/to/before/after | 2 |
| AT-14 | 搬移超容量／混放 | API | 兩種情況分別 409，來源不變 | 2 |
| AT-15 | 工作人員新增與拖曳貨架 | API, E2E | staff PUT /layout 200；GET 回傳新座標 | 3 |
| AT-16 | 拖曳儲位後庫存不變 | API, E2E | 儲存布局前後 Inventory、Movement 筆數與數值相同 | 3 |
| AT-17 | 刪除有庫存儲位 | API, E2E | DELETE → 409 `LOCATION_NOT_EMPTY`；含庫存貨架同樣拒絕 | 3 |
| AT-18 | 從儲位入庫／出庫 | E2E | 平面圖點儲位 → 表單預帶儲位／批次 → 完成後儲位數量正確 | 3/4 |

### 2.3 報損／盤點／權限

| AT | 情境 | 測試層級 | 測試內容 | Stage |
|---|---|---|---|---|
| AT-19 | 報損 3 籠 | API | 庫存 −3；DAMAGE 紀錄含 reason、operator | 2 |
| AT-20 | 超額報損 | API | 409 `INSUFFICIENT_STOCK` | 2 |
| AT-21 | 工作人員提交盤點 | API | 201、status PENDING；Inventory 不變 | 4 |
| AT-22 | 工作人員試圖核准 | API, E2E | API 403 `FORBIDDEN`；前端無核准按鈕 | 4 |
| AT-23 | 管理員核准／退回 | API | approve → Inventory = countedQty、ADJUSTMENT 紀錄；reject → 不變 | 4 |
| AT-24 | 提交後庫存又改變 | API | 提交後出庫 → approve 409 `STOCKTAKE_CONFLICT`，庫存不變 | 4 |
| AT-25 | 異動歷史 | API, E2E | 執行五類操作後 `/movements?type=` 各可查；數量前後可追溯 | 2/4 |

### 2.4 整合展示情境（E2E，Stage 5）

甘藍菜入庫 30（20+10）→ 搬移 5 → 出庫 10（FEFO）→ 報損 3 → 商品總量 **17**；儲位明細合計 17；異動紀錄 IN×2、TRANSFER×1、OUT×n、DAMAGE×1；重新整理後仍為 17。

---

## 3. 資料完整性專項測試（PRD §七／不變量）

| # | 規則 | 測試方法 |
|---|---|---|
| I-1 | 不可負庫存 | 直接以 Prisma 嘗試寫入 −1 → DB CHECK 失敗 |
| I-2 | 交易原子性 | 在 stockService 交易中注入錯誤（mock 第二步拋例外）→ 無任何寫入 |
| I-3 | 重複提交 | 同 Idempotency-Key 送兩次出庫 → 只扣一次、回傳相同結果 |
| I-4 | 並發 | `Promise.all` 同時送 20 筆各扣 1 的出庫（可用 10）→ 恰好 10 成功、10 個 409、最終 0 |
| I-5 | 權限後端驗證 | 以 staff token 直接呼叫 approve、users → 403（NFR-04） |
| I-6 | 密碼不明文 | DB 中 passwordHash 以 `$2` 開頭且 ≠ 明文（NFR-10） |
| I-7 | 布局不改庫存 | PUT layout 前後 Inventory 雜湊相同 |
| I-8 | 單位不合計 | dashboard 回傳依單位分組，不出現跨單位總和 |

---

## 4. 非功能驗證

| NFR | 方法 |
|---|---|
| NFR-01 繁中 | 人工檢查每頁 |
| NFR-02 響應式 | Playwright 以 375×812 viewport 跑核心流程；人工手機檢查 |
| NFR-03 持久化 | AT-08 |
| NFR-04/05/06/10 | §3 |
| NFR-07 錯誤訊息 | 每個 409 測試斷言 message 含關鍵字（儲位代碼、容量、商品名） |
| NFR-08 自動化 | CI 指令 `npm test` 全綠；E2E 報告附截圖 |
| NFR-09 Git | `git log --oneline` 每 Stage 至少一次提交 |

---

## 5. 執行指令

```bash
npm test                    # 所有 Vitest（server + web）
npm run test:server         # 僅後端 API／單元
npm run test:e2e            # Playwright（需先 npm run dev 或由 config webServer 啟動）
```

## 6. 完成標準

- 每個 Stage 的對應測試全部通過並記錄於交付報告。
- Stage 5 結束時：AT-01～AT-25 各至少有一個自動化或人工驗證項目標記「已執行、通過」，未通過者如實列出。


---

## 7. 執行狀態（2026-09-23，Stage 5）

| 層級 | 指令 | 結果 |
|---|---|---|
| API／整合（Workers pool，每測試獨立 DO 儲存） | `npm run test:worker` | **45 項通過**：AT-01～07、09、11～17、19～25；I-1（DB CHECK）、I-3（Idempotency）、I-4（並發 20 筆恰好 10 成功）、I-5、I-6、I-7、I-8；配對節流；展示重置權限 |
| 前端單元 | `npm run test -w web` | 5 項通過（平面圖幾何） |
| E2E（Playwright，桌機 1440＋手機 Pixel 5） | `npm run test:e2e` | **10 項通過**：整合情境 30→5→10→3＝17（含 AT-04 即時提示、AT-08 重新整理）、AT-09／10 搜尋定位、AT-15／16／17／18 平面圖、AT-21～24 盤點權限、NFR-02 手機無橫向溢出 |
| 人工驗證 | `docs/MANUAL_VERIFICATION.md` | 待組員填寫（含手機／平板實機） |

未自動化、以人工驗證為主：NFR-01 繁中、NFR-02 實機觸控、AT-14 圖上點擊混放提示（有單元層 API 測試）。
