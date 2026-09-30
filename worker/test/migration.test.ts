import { describe, expect, it } from "vitest";
import { MIGRATE_V4_TO_V5, POST_MIGRATION_SQL, SCHEMA_SQL } from "../src/db/schema.js";

/**
 * 2026-09-30 回歸：SCHEMA_SQL 會在「舊資料庫」上先執行（CREATE TABLE IF NOT EXISTS 不會補欄位），
 * 所以它不能建立依賴遷移新欄位的索引，否則舊資料庫一啟動就 no such column，整站掛掉。
 */
describe("資料庫升級順序", () => {
  it("基本 schema 不得建立 receivedAt 索引；索引只在遷移與遷移後建立", () => {
    const sqlOnly = SCHEMA_SQL.replace(/--.*$/gm, "");
    expect(sqlOnly).not.toMatch(/CREATE INDEX[^;]*receivedAt/);
    expect(MIGRATE_V4_TO_V5).toMatch(/ALTER TABLE Batch ADD COLUMN receivedAt/);
    expect(POST_MIGRATION_SQL).toMatch(/Batch_product_received/);
  });
});
