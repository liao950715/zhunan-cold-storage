/**
 * Worker 入口：/api/* 交給 Durable Object（WarehouseDO）處理，其餘由靜態資產（web/dist）回應。
 * 正式站：單一 DO（name `main`）＝ 所有庫存操作序列化；SQLite 交易由 DO storage 提供。
 * 示範站（DEMO_SANDBOX=per-browser）：每個瀏覽器一份示範資料（cookie → 各自的 DO），互不影響。
 */
import { DurableObject } from "cloudflare:workers";
import { createApp } from "./app.js";
import { Db } from "./lib/sql.js";
import { taipeiDateOf, todayString } from "./lib/dates.js";
import { MIGRATE_V1_TO_V2, MIGRATE_V2_TO_V3, MIGRATE_V3_TO_V4, MIGRATE_V4_TO_V5, MIGRATE_V5_TO_V6, POST_MIGRATION_SQL, SCHEMA_SQL, SCHEMA_VERSION } from "./db/schema.js";
import { seedBase, seedDemoStock } from "./seed.js";

export interface Env {
  WAREHOUSE: DurableObjectNamespace<WarehouseDO>;
  ASSETS?: Fetcher;
  JWT_SECRET?: string;
  SYNC_SECRET?: string;
  /** "rich"＝示範站：填滿的示範資料；配合 Cron 每天重置 */
  DEMO_MODE?: string;
  /** "off"＝不需同步碼配對（示範站） */
  PAIRING?: string;
  /** "per-browser"＝示範站每個瀏覽器各一份資料；重新整理（改過資料時）換新的一份，閒置後自動刪除。正式站不可設定 */
  DEMO_SANDBOX?: string;
}

/** 示範資料閒置多久刪除；使用中每次往後延（30 分鐘內重複使用不重寫計時，省資料庫寫入） */
const SANDBOX_IDLE_MS = 6 * 3_600_000;
const ALARM_SLACK_MS = 30 * 60_000;
/** 這些成功的非 GET 請求不算「改過資料」：登入登出、配對、出庫建議（只是查詢）、重置本身 */
const NOT_A_CHANGE = ["/api/auth/", "/api/pair", "/api/stock/outbound/suggest", "/api/admin/reset-demo"];

export class WarehouseDO extends DurableObject<Env> {
  private app: ReturnType<typeof createApp> | null = null;
  private db: Db | null = null;
  private ready: Promise<void> | null;
  private resetDemoFn: ((seedMode?: "basic" | "rich") => Promise<{ ok: true }>) | null = null;
  /** 示範資料建好之後有沒有被改過（改過才需要在重新整理時換新的一份） */
  private dirty = false;
  private alarmAt = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ready = this.start();
  }

  private get perBrowser() {
    return this.env.DEMO_SANDBOX === "per-browser";
  }
  private start() {
    return this.ctx.blockConcurrencyWhile(() => this.init());
  }
  /** 閒置刪除後再有人來：重新建表＋種子資料 */
  private ensureReady() {
    return (this.ready ??= this.start());
  }

  private async init() {
    const db = new Db(this.ctx.storage);
    db.exec(SCHEMA_SQL);
    const v = db.one<{ value: string }>("SELECT value FROM meta WHERE key = 'schemaVersion'");
    if (!v) db.run("INSERT INTO meta (key, value) VALUES ('schemaVersion', ?)", String(SCHEMA_VERSION));
    else {
      if (Number(v.value) < 2) db.tx(() => db.exec(MIGRATE_V1_TO_V2)); // 既有資料庫：升級到 v2（FR-020 復原）
      if (Number(v.value) < 3) db.tx(() => db.exec(MIGRATE_V2_TO_V3)); // v3：防重送識別碼綁定請求內容
      if (Number(v.value) < 4) db.tx(() => db.exec(MIGRATE_V3_TO_V4)); // v4：盤點差異原因
      if (Number(v.value) < 5) db.tx(() => db.exec(MIGRATE_V4_TO_V5)); // v5：批次進貨時間（先進先出）
      if (Number(v.value) < 6) db.tx(() => db.exec(MIGRATE_V5_TO_V6)); // v6：盤點附帶報損
    }
    db.exec(POST_MIGRATION_SQL);
    const mode = this.env.DEMO_MODE === "rich" ? "rich" : "basic";
    // 記下「剛建好示範資料」：建立時間（示範站判斷是不是今天的資料）＋清掉「改過」標記
    const markSeeded = () => {
      db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('seededAt', ?)", new Date().toISOString());
      db.run("DELETE FROM meta WHERE key = 'demoDirty'");
      this.dirty = false;
    };
    if (db.one<{ n: number }>("SELECT COUNT(*) AS n FROM User")!.n === 0) {
      await seedBase(db);
      seedDemoStock(db, mode);
      markSeeded();
    }
    const resetDemo = async (seedMode: "basic" | "rich" = mode) => {
      // 交易內清空所有業務資料（保留 meta），再重新 seed；使用者也重建（示範帳號）
      db.tx(() => {
        for (const t of ["IdempotencyKey", "StocktakeDamage", "StocktakeItem", "Stocktake", "StockMovement", "Inventory", "LocationCapacity", "Batch", "BatchCounter", "Location", "Rack", "Warehouse", "Product", "PairAttempt", "User"]) db.run(`DELETE FROM ${t}`);
        db.run("DELETE FROM sqlite_sequence");
      });
      await seedBase(db);
      seedDemoStock(db, seedMode);
      markSeeded();
      return { ok: true as const };
    };
    this.dirty = !!db.one("SELECT 1 FROM meta WHERE key = 'demoDirty'");
    this.db = db;
    this.app = createApp({
      db,
      jwtSecret: this.env.JWT_SECRET || "dev-only-secret-change-me",
      syncSecret: (this.env.SYNC_SECRET || "").trim(),
      pairingDisabled: this.env.PAIRING === "off",
      resetDemo: () => resetDemo(),
    });
    this.resetDemoFn = resetDemo;
  }

  /** Cron 用（DO RPC，外部 HTTP 打不到）：與「重置為展示資料」相同的函式；seedMode 預設依 DEMO_MODE */
  async resetFromCron(seedMode?: "basic" | "rich") {
    await this.ensureReady();
    return this.resetDemoFn!(seedMode);
  }

  async fetch(request: Request): Promise<Response> {
    await this.ensureReady();
    const res = await this.app!.fetch(request);
    if (this.perBrowser) await this.afterRequest(request, res);
    return res;
  }

  // ---------- 示範站：每個瀏覽器一份 ----------

  /** 記下「改過資料」（只寫一次）＋閒置計時往後延。 */
  private async afterRequest(request: Request, res: Response) {
    if (!this.dirty && request.method !== "GET" && res.ok) {
      const path = new URL(request.url).pathname;
      if (!NOT_A_CHANGE.some((p) => path.startsWith(p))) {
        this.db!.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('demoDirty', '1')");
        this.dirty = true;
      }
    }
    await this.touch();
  }

  private async touch() {
    const due = Date.now() + SANDBOX_IDLE_MS;
    if (due - this.alarmAt > ALARM_SLACK_MS) {
      this.alarmAt = due;
      await this.ctx.storage.setAlarm(due);
    }
  }

  /** 閒置過久：整份示範資料刪掉；之後同一個瀏覽器再來會自動重建初始資料。 */
  async alarm() {
    if (!this.perBrowser) return;
    await this.ctx.storage.deleteAll();
    this.app = null;
    this.db = null;
    this.ready = null;
    this.dirty = false;
    this.alarmAt = 0;
  }

  /** RPC：這份示範資料改過沒、哪一天（台灣）建立的 → 決定重新整理時要不要換新的一份 */
  async sandboxState() {
    await this.ensureReady();
    const seededAt = this.db!.one<{ value: string }>("SELECT value FROM meta WHERE key = 'seededAt'")?.value;
    return { dirty: this.dirty, seededDate: seededAt ? taipeiDateOf(seededAt) : null };
  }

  /** RPC：先把資料建好（第一次會建表＋種子），並開始閒置計時 */
  async warm() {
    await this.ensureReady();
    if (this.perBrowser) await this.touch();
    return { ok: true as const };
  }
}

const SANDBOX_COOKIE = "demo_sandbox";
const perBrowser = (env: Env) => env.DEMO_SANDBOX === "per-browser";
/** 這個瀏覽器的示範資料編號（32 位 16 進位；格式不對當作沒有） */
function sandboxOf(request: Request) {
  return /(?:^|;\s*)demo_sandbox=([0-9a-f]{32})(?:;|$)/.exec(request.headers.get("Cookie") ?? "")?.[1] ?? null;
}
/** 有示範資料編號 → 那個瀏覽器自己的 DO；沒有（正式站、curl、腳本）→ 共用的 main */
const stubFor = (env: Env, sandbox: string | null) => env.WAREHOUSE.get(env.WAREHOUSE.idFromName(sandbox ? `sandbox:${sandbox}` : "main"));

/**
 * POST /api/demo/session {fresh}：前端每次開頁先呼叫。
 * 正式站 → {demo:false}。示範站 → 第一次開啟給一份新的；fresh（重新整理、按「重置示範資料」）且資料改過或不是今天建的 → 換一份新的。
 */
async function demoSession(request: Request, env: Env) {
  if (request.method !== "POST") return Response.json({ error: { code: "NOT_FOUND", message: "找不到此 API" } }, { status: 404 });
  const noStore = { "Cache-Control": "no-store" };
  if (!perBrowser(env)) return Response.json({ demo: false }, { headers: noStore });
  // 只收 JSON：別的網站無法用表單偷送（CSRF）來換掉訪客的示範資料
  if (!request.headers.get("Content-Type")?.includes("application/json")) {
    return Response.json({ error: { code: "VALIDATION_ERROR", message: "請以 JSON 送出" } }, { status: 415 });
  }
  const { fresh } = (await request.json().catch(() => ({}))) as { fresh?: unknown };
  const current = sandboxOf(request);
  let sandbox = current;
  // 沒改過、又是今天建的那份，本來就是初始資料：不必重建（省資料庫寫入）
  if (sandbox && fresh === true) {
    const s = await stubFor(env, sandbox).sandboxState();
    if (s.dirty || s.seededDate !== todayString()) sandbox = null;
  }
  sandbox ??= crypto.randomUUID().replace(/-/g, "");
  await stubFor(env, sandbox).warm();
  return Response.json(
    { demo: true, created: sandbox !== current },
    { headers: { ...noStore, "Set-Cookie": `${SANDBOX_COOKIE}=${sandbox}; Path=/; HttpOnly; Secure; SameSite=Lax` } },
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/demo/session") return demoSession(request, env);
    if (url.pathname.startsWith("/api/")) return stubFor(env, perBrowser(env) ? sandboxOf(request) : null).fetch(request);
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Not found", { status: 404 });
  },
  /** 示範站：Cron 每天重置成初始示範資料（只有 DEMO_MODE=rich 的部署有排程；每個瀏覽器一份時，重置的是沒帶 cookie 共用的那份） */
  async scheduled(_event: ScheduledController, env: Env) {
    if (env.DEMO_MODE !== "rich") return;
    const stub = env.WAREHOUSE.get(env.WAREHOUSE.idFromName("main"));
    await stub.resetFromCron();
  },
} satisfies ExportedHandler<Env>;
