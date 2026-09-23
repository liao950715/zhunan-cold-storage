# 竹南冷凍倉儲庫存管理系統

大學「系統分析與設計」課程專案。Web 庫存管理系統：商品／批次／儲位三層追蹤、可編輯 2D 冷凍庫平面圖、入出庫／搬移／報損／盤點與完整異動紀錄。

- 需求：[docs/PRD.md](docs/PRD.md)、[docs/REQUIREMENTS_DECISIONS.md](docs/REQUIREMENTS_DECISIONS.md)
- 設計：[docs/TECHNICAL_DESIGN.md](docs/TECHNICAL_DESIGN.md)、[docs/DATABASE_DESIGN.md](docs/DATABASE_DESIGN.md)
- 測試與計畫：[docs/TEST_PLAN.md](docs/TEST_PLAN.md)、[docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md)
- AI 協作規範：[AGENTS.md](AGENTS.md)

## 技術

React + TypeScript + Vite + Tailwind + React Konva ｜ Node.js + Express + Prisma + SQLite ｜ Vitest + Supertest + Playwright

## 執行

```bash
npm install
npm run dev        # server http://localhost:3001，web http://localhost:5173
npm test
```

目前狀態：**Stage 0（環境與設計）**。功能尚未實作，見 `docs/IMPLEMENTATION_PLAN.md`。
