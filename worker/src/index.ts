/**
 * Worker 入口：/api/* 交給單一 Durable Object（WarehouseDO）處理，其餘由靜態資產（web/dist）回應。
 * 單一 DO ＝ 所有庫存操作序列化；SQLite 交易由 DO storage 提供。
 */
import { DurableObject } from "cloudflare:workers";
import { createApp } from "./app.js";
import { Db } from "./lib/sql.js";
import { MIGRATE_V1_TO_V2, SCHEMA_SQL, SCHEMA_VERSION } from "./db/schema.js";
import { seedBase, seedDemoStock } from "./seed.js";

export interface Env {
  WAREHOUSE: DurableObjectNamespace<WarehouseDO>;
  ASSETS?: Fetcher;
  JWT_SECRET?: string;
  SYNC_SECRET?: string;
}

export class WarehouseDO extends DurableObject<Env> {
  private app: ReturnType<typeof createApp> | null = null;
  private ready: Promise<void>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ready = this.ctx.blockConcurrencyWhile(async () => {
      const db = new Db(this.ctx.storage);
      db.exec(SCHEMA_SQL);
      const v = db.one<{ value: string }>("SELECT value FROM meta WHERE key = 'schemaVersion'");
      if (!v) db.run("INSERT INTO meta (key, value) VALUES ('schemaVersion', ?)", String(SCHEMA_VERSION));
      else if (Number(v.value) < 2) db.tx(() => db.exec(MIGRATE_V1_TO_V2)); // 既有資料庫：升級到 v2（FR-020 復原）
      if (db.one<{ n: number }>("SELECT COUNT(*) AS n FROM User")!.n === 0) {
        await seedBase(db);
        seedDemoStock(db);
      }
      this.app = createApp({
        db,
        jwtSecret: env.JWT_SECRET || "dev-only-secret-change-me",
        syncSecret: (env.SYNC_SECRET || "").trim(),
        resetDemo: async () => {
          // 交易內清空所有業務資料（保留 meta），再重新 seed；使用者也重建（示範帳號）
          db.tx(() => {
            for (const t of ["IdempotencyKey", "StocktakeItem", "Stocktake", "StockMovement", "Inventory", "LocationCapacity", "Batch", "BatchCounter", "Location", "Rack", "Warehouse", "Product", "PairAttempt", "User"]) db.run(`DELETE FROM ${t}`);
            db.run("DELETE FROM sqlite_sequence");
          });
          await seedBase(db);
          seedDemoStock(db);
          return { ok: true as const };
        },
      });
    });
  }

  async fetch(request: Request): Promise<Response> {
    await this.ready;
    return this.app!.fetch(request);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      const stub = env.WAREHOUSE.get(env.WAREHOUSE.idFromName("main"));
      return stub.fetch(request);
    }
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
