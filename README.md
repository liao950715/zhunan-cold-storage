# 竹南冷凍倉儲庫存管理系統

大學「系統分析與設計」課程專案。Web／PWA 庫存管理系統：商品／批次／儲位三層追蹤、可編輯 2D 冷凍庫平面圖、入出庫／搬移／報損／盤點與完整異動紀錄。介面針對現場與中老年使用者設計（大字、單欄步驟、顏色＋文字並用）。

| | |
|---|---|
| 示範網站 | [https://zhunan-cold-storage-demo.liao950715.workers.dev/](https://zhunan-cold-storage-demo.liao950715.workers.dev/) — 示範帳號 `admin/admin1234`、`staff/staff1234`（不需同步碼）；歡迎隨意操作：**每個瀏覽器各有一份示範資料**，互不影響；第一次開啟、按重新整理或畫面上方的「重置示範資料」都會回到初始資料 |
| GitHub | [github.com/liao950715/zhunan-cold-storage](https://github.com/liao950715/zhunan-cold-storage) |

### 示範站帳號（不需同步碼，直接登入）

| 身分 | 帳號 | 密碼 | 可以做的事 |
|---|---|---|---|
| 管理員 | `admin` | `admin1234` | 全部功能：入出庫、搬移、報損、盤點審核、復原異動、商品與帳號管理、重置示範資料 |
| 倉庫員工 | `staff` | `staff1234` | 查庫存、入庫、出庫、搬移、報損、盤點申報、編輯平面圖 |

- 需求：[docs/PRD.md](docs/PRD.md)、[docs/REQUIREMENTS_DECISIONS.md](docs/REQUIREMENTS_DECISIONS.md)
- 設計：[docs/TECHNICAL_DESIGN.md](docs/TECHNICAL_DESIGN.md)、[docs/DATABASE_DESIGN.md](docs/DATABASE_DESIGN.md)、[docs/UI_DESIGN.md](docs/UI_DESIGN.md)
- 測試與計畫：[docs/TEST_PLAN.md](docs/TEST_PLAN.md)、[docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md)
- AI 協作規範：[AGENTS.md](AGENTS.md)

## 技術

| 層 | 技術 |
|---|---|
| 前端 | React 18 + TypeScript + Vite + Tailwind v4 + React Konva；PWA（vite-plugin-pwa）；字體：芫荽 Iansui |
| 後端 | Cloudflare Workers + Hono，**單一 Durable Object（SQLite）** 保存全部資料：真正的交易、單執行緒＝所有庫存操作序列化 |
| 部署 | 一個 Worker 同時提供 API（`/api/*`）與前端靜態檔（`web/dist`） |
| 測試 | Vitest + `@cloudflare/vitest-pool-workers`（每個測試獨立 DO 儲存） |

## 本機執行

```bash
npm install
cp worker/.dev.vars.example worker/.dev.vars   # 設定本機 JWT_SECRET、SYNC_SECRET（同步碼）
npm run dev        # API http://localhost:8787（wrangler dev）、web http://localhost:5173
npm test           # worker 81 項＋示範站模式 8 項＋web 5 項
npm run test:e2e   # 瀏覽器端對端 20 項（需要 npm run dev）
npm run test:demo-site   # 示範站主要功能 14 項（自動用示範站設定開本機副本 :8788）
```

第一次開啟：輸入 `.dev.vars` 的同步碼配對裝置 → 以 `admin/admin1234` 或 `staff/staff1234` 登入（示範帳號）。

## 部署到 Cloudflare

```bash
npx wrangler secret put JWT_SECRET -c worker/wrangler.jsonc
npx wrangler secret put SYNC_SECRET -c worker/wrangler.jsonc   # 同步碼（≥16 字元）
npm run deploy     # build web → wrangler deploy
```

資料存在 Durable Object `WarehouseDO`（name `main`）內的 SQLite；第一次啟動自動建表與 seed 示範資料。

### 示範站（每個瀏覽器一份、重新整理就重置）

`worker/wrangler.demo.jsonc` 是第二個 Worker（`zhunan-cold-storage-demo`）：`PAIRING=off` 免同步碼配對、`DEMO_MODE=rich` 讓 seed 填滿大部分儲位（多批次、快到期、已過期）、`DEMO_SANDBOX=per-browser` 讓每個瀏覽器各有一份示範資料：

- 前端每次開頁先呼叫 `POST /api/demo/session`；Worker 依 cookie `demo_sandbox` 把這個瀏覽器的請求送到它自己的 Durable Object（`sandbox:<編號>`），別人的操作不會影響你。
- 第一次開啟、按重新整理、按畫面上方的「重置示範資料」→ 回到初始示範資料（仍保持登入）。資料沒被改過就沿用原本那份（本來就是初始資料，省資料庫寫入）。
- 同一個瀏覽器的分頁共用同一份；**切換角色請登出再登入，不要重新整理**（重新整理會回到初始資料）。無痕視窗／另一個瀏覽器是另一份資料。
- 閒置 6 小時的示範資料自動刪除（Durable Object alarm）。沒帶 cookie 的呼叫（curl、腳本）走共用的 `main`，Cron（`0 19 * * *` UTC＝台灣 03:00）每天重置它。
- 正式站沒有設定 `DEMO_SANDBOX`，行為完全不變（`/api/demo/session` 回 `{demo:false}`）。

```bash
npx wrangler secret put JWT_SECRET -c worker/wrangler.demo.jsonc
npm run deploy:demo
npm run test:demo-site                 # 示範站主要功能檢查（本機示範站副本 http://localhost:8788）
DEMO_URL=https://zhunan-cold-storage-demo.liao950715.workers.dev npm run test:demo-site   # 部署後檢查線上示範站
```
