# 竹南冷凍倉儲庫存管理系統

大學「系統分析與設計」課程專案。Web／PWA 庫存管理系統：商品／批次／儲位三層追蹤、可編輯 2D 冷凍庫平面圖、入出庫／搬移／報損／盤點與完整異動紀錄。介面針對現場與中老年使用者設計（大字、單欄步驟、顏色＋文字並用）。

| | |
|---|---|
| 線上系統 | **https://zhunan-cold-storage.liao950715.workers.dev**（第一次開啟需輸入同步碼，向管理員取得；示範帳號 `admin/admin1234`、`staff/staff1234`） |
| GitHub | **https://github.com/liao950715/zhunan-cold-storage** |

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
npm test           # worker 44 項 + web 5 項
```

第一次開啟：輸入 `.dev.vars` 的同步碼配對裝置 → 以 `admin/admin1234` 或 `staff/staff1234` 登入（示範帳號）。

## 部署到 Cloudflare

```bash
npx wrangler secret put JWT_SECRET -c worker/wrangler.jsonc
npx wrangler secret put SYNC_SECRET -c worker/wrangler.jsonc   # 同步碼（≥16 字元）
npm run deploy     # build web → wrangler deploy
```

資料存在 Durable Object `WarehouseDO`（name `main`）內的 SQLite；第一次啟動自動建表與 seed 示範資料。
