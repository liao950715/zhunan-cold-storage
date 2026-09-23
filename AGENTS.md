# AGENTS.md — 竹南冷凍倉儲庫存管理系統 AI Agent 工作規範

本檔案適用於所有在本 repo 工作的 AI Agent（Claude Code、Codex 等）與人類協作者。

## 1. 開發前

1. **先讀規格**：`docs/PRD.md` 是需求基準；再讀 `docs/TECHNICAL_DESIGN.md`、`docs/DATABASE_DESIGN.md`、`docs/TEST_PLAN.md`、`docs/IMPLEMENTATION_PLAN.md`。
2. **不得自行刪除、簡化或修改已確認的業務需求**。規格衝突、缺漏或需要決策時，先提出問題或列入待確認事項，不自行決定。
3. 只做目前被指派的 Stage；不提前實作後續 Stage 的功能。
4. 開始修改前先提出修改計畫（涉及檔案、測試、風險），再動手。

## 2. 修改中

5. **每次修改前檢查現有程式**：先讀取要改的檔案與相關呼叫處，不盲改。
6. **不得覆蓋使用者既有修改**：修改前確認 `git status`／`git diff`；不使用 `git checkout -- <file>`、`git reset --hard`、`git stash drop` 等會丟失他人工作的指令。
7. 庫存數量的任何變更只能透過 `server/src/services/stockService.ts` 的交易函式；不得在其他地方直接寫 `Inventory`。
8. 權限檢查必須在後端 middleware 實作；前端隱藏按鈕不算完成。
9. 使用繁體中文撰寫使用者可見文字與文件；程式識別字用英文。
10. 不引入未在 `docs/TECHNICAL_DESIGN.md` 列出的重大依賴；需要時先說明原因。

## 3. 測試

11. **修改後新增或更新測試**：新功能對應 `docs/TEST_PLAN.md` 的 AT／I 編號；修 bug 先寫重現測試。
12. **實際執行測試**：`npm test`（必要時 `npm run test:e2e`）。
13. **測試失敗時先修復**，不得跳過、標記 skip 或刪除測試來讓它變綠；確實無法修復時如實回報。
14. **不得把未執行的測試宣稱為通過**。回報必須附實際指令與輸出摘要。

## 4. Git

15. 功能完成且測試通過後建立 **Git commit**；訊息格式：`<type>(<scope>): <摘要>`（例：`feat(stock): 入庫多儲位分配與容量驗證`）。
16. **不自動 push**；**禁止 force push**；不改寫已存在的提交歷史（不 `--amend` 他人提交、不 rebase 已共享分支）。
17. 不 commit `server/prisma/*.db`、`node_modules`、`.env`（見 `.gitignore`）。

## 5. 交付回報格式

每次任務完成時列出：

1. 修改／新增的檔案清單。
2. 測試結果（指令、通過／失敗數、失敗原因）。
3. Git commit hash 與訊息。
4. 尚待確認的問題或已知限制。

## 6. 安全與資料

18. 密碼一律 bcrypt 雜湊，不記錄明文、不寫入 log。
19. `operatorId` 一律取自登入 token，不信任 request body。
20. 種子資料為模擬示範，不得在文件或簡報中當成公司真實資料。
