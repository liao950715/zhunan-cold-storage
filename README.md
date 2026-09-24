# 竹南冷凍倉儲庫存管理系統

大學「系統分析與設計」課程專案。Web／PWA 庫存管理系統：商品／批次／儲位三層追蹤、可編輯 2D 冷凍庫平面圖、入出庫／搬移／報損／盤點與完整異動紀錄。介面針對現場與中老年使用者設計（大字、單欄步驟、顏色＋文字並用）。

| | |
|---|---|
| 線上示範站 | [zhunan-cold-storage-demo.liao950715.workers.dev](https://zhunan-cold-storage-demo.liao950715.workers.dev/) — 歡迎隨意操作，**每天 03:00（台灣時間）自動重置**為示範資料 |
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
npm test           # worker 56 項 + web 5 項
```

第一次開啟：輸入 `.dev.vars` 的同步碼配對裝置 → 以 `admin/admin1234` 或 `staff/staff1234` 登入（示範帳號）。

## 部署到 Cloudflare

```bash
npx wrangler secret put JWT_SECRET -c worker/wrangler.jsonc
npx wrangler secret put SYNC_SECRET -c worker/wrangler.jsonc   # 同步碼（≥16 字元）
npm run deploy     # build web → wrangler deploy
```

資料存在 Durable Object `WarehouseDO`（name `main`）內的 SQLite；第一次啟動自動建表與 seed 示範資料。

### 示範站（每日自動重置）

`worker/wrangler.demo.jsonc` 是第二個 Worker（`zhunan-cold-storage-demo`）：`PAIRING=off` 免同步碼配對、`DEMO_MODE=rich` 讓 seed 填滿大部分儲位（多批次、快到期、已過期），並以 Cron（`0 19 * * *` UTC＝台灣 03:00）呼叫 Durable Object 的 `resetFromCron()` 重置成初始資料。

```bash
npx wrangler secret put JWT_SECRET -c worker/wrangler.demo.jsonc
npm run deploy:demo
```
