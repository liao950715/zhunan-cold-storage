/**
 * Hono 路由（在 Durable Object 內執行）。權限、配對、驗證都在後端強制（NFR-04）。
 */
import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { sign, verify } from "hono/jwt";
import { z, ZodError } from "zod";
import type { Db } from "./lib/sql.js";
import { AppError } from "./lib/errors.js";
import { dateString } from "./lib/dates.js";
import { hashPassword, randomHex, sha256Hex, timingSafeEqual, verifyPassword } from "./lib/crypto.js";
import * as q from "./services/queryService.js";
import * as stock from "./services/stockService.js";
import { deleteLocation, deleteRack, saveLayout } from "./services/layoutService.js";

export interface AppEnv { db: Db; jwtSecret: string; syncSecret: string; resetDemo: () => Promise<{ ok: true }> }
type Role = "ADMIN" | "STAFF";
interface AuthUser { id: number; username: string; displayName: string; role: Role }
type Vars = { user: AuthUser };

const TOKEN_COOKIE = "token";
const PAIR_COOKIE = "paired";
const PAIR_TTL_DAYS = 90;
const PAIR_MAX_ATTEMPTS = 8;
const PAIR_WINDOW_MS = 15 * 60 * 1000;

const id = z.number().int().positive();
const positiveInt = z.number().int().positive("數量必須是正整數");
const idParam = (s: string, name = "id") => {
  const n = Number(s);
  if (!Number.isInteger(n) || n <= 0) throw new AppError("VALIDATION_ERROR", 400, `參數 ${name} 必須是正整數`);
  return n;
};

export function createApp(env: AppEnv) {
  const { db } = env;
  const app = new Hono<{ Variables: Vars }>();
  const cookieOpts = { httpOnly: true, sameSite: "Lax" as const, path: "/", secure: true };

  app.onError((err, c) => {
    if (err instanceof AppError) return c.json({ error: { code: err.code, message: err.message, details: err.details } }, err.status as 400);
    if (err instanceof ZodError) {
      return c.json({ error: { code: "VALIDATION_ERROR", message: "輸入資料有誤：" + err.issues.map((i) => `${i.path.join(".") || "body"} ${i.message}`).join("；"), details: err.issues } }, 400);
    }
    const msg = String((err as Error)?.message ?? "");
    if (/UNIQUE constraint/.test(msg)) return c.json({ error: { code: "CONFLICT", message: "資料重複，違反唯一性限制" } }, 409);
    console.error(err);
    return c.json({ error: { code: "INTERNAL_ERROR", message: "系統發生錯誤，請稍後再試" } }, 500);
  });

  app.get("/api/health", (c) => c.json({ status: "ok", service: "zhunan-cold-storage", runtime: "cloudflare-do" }));

  // ---------- 裝置配對（同步碼） ----------
  const clientKey = (c: { req: { header: (n: string) => string | undefined } }) => c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const pairToken = (secret: string) => sha256Hex(`pair:${secret}`);

  app.get("/api/pair", async (c) => {
    const cookie = getCookie(c, PAIR_COOKIE);
    const paired = !!cookie && timingSafeEqual(cookie, await pairToken(env.syncSecret));
    return c.json({ paired, configured: env.syncSecret.length >= 16 });
  });

  app.post("/api/pair", async (c) => {
    if (env.syncSecret.length < 16) throw new AppError("INTERNAL_ERROR", 503, "尚未設定同步碼");
    const key = clientKey(c);
    const now = Date.now();
    const row = db.one<{ attempts: number; windowStart: number }>("SELECT attempts, windowStart FROM PairAttempt WHERE clientKey = ?", key);
    if (row && now - row.windowStart <= PAIR_WINDOW_MS && row.attempts >= PAIR_MAX_ATTEMPTS) throw new AppError("TOO_MANY_ATTEMPTS", 429, "嘗試次數過多，請 15 分鐘後再試");
    const body = z.object({ code: z.string().min(1, "請輸入同步碼") }).parse(await c.req.json());
    if (!timingSafeEqual(body.code.trim(), env.syncSecret)) {
      if (!row || now - row.windowStart > PAIR_WINDOW_MS) db.run("INSERT INTO PairAttempt (clientKey, attempts, windowStart) VALUES (?, 1, ?) ON CONFLICT(clientKey) DO UPDATE SET attempts = 1, windowStart = excluded.windowStart", key, now);
      else db.run("UPDATE PairAttempt SET attempts = attempts + 1 WHERE clientKey = ?", key);
      throw new AppError("UNAUTHENTICATED", 401, "同步碼不正確");
    }
    db.run("DELETE FROM PairAttempt WHERE clientKey = ?", key);
    setCookie(c, PAIR_COOKIE, await pairToken(env.syncSecret), { ...cookieOpts, maxAge: PAIR_TTL_DAYS * 86400 });
    return c.json({ paired: true });
  });

  app.delete("/api/pair", (c) => {
    deleteCookie(c, PAIR_COOKIE, { path: "/" });
    deleteCookie(c, TOKEN_COOKIE, { path: "/" });
    return c.json({ paired: false });
  });

  // 配對閘門：除 health／pair 外都要先配對
  app.use("/api/*", async (c, next) => {
    if (c.req.path === "/api/health" || c.req.path === "/api/pair") return next();
    const cookie = getCookie(c, PAIR_COOKIE);
    if (!cookie || !timingSafeEqual(cookie, await pairToken(env.syncSecret))) throw new AppError("NOT_PAIRED", 401, "此裝置尚未配對，請先輸入同步碼");
    return next();
  });

  // ---------- 登入 ----------
  const userOf = (row: { id: number; username: string; displayName: string; role: string }): AuthUser => ({ id: row.id, username: row.username, displayName: row.displayName, role: row.role as Role });

  app.post("/api/auth/login", async (c) => {
    const { username, password } = z.object({ username: z.string().min(1, "請輸入帳號"), password: z.string().min(1, "請輸入密碼") }).parse(await c.req.json());
    const row = db.one<{ id: number; username: string; passwordHash: string; displayName: string; role: string; status: string }>("SELECT * FROM User WHERE username = ?", username);
    const ok = row ? await verifyPassword(password, row.passwordHash) : false;
    if (!row || !ok) throw new AppError("UNAUTHENTICATED", 401, "帳號或密碼錯誤");
    if (row.status !== "ACTIVE") throw new AppError("UNAUTHENTICATED", 401, "此帳號已停用");
    const token = await sign({ sub: String(row.id), role: row.role, exp: Math.floor(Date.now() / 1000) + 12 * 3600 }, env.jwtSecret);
    setCookie(c, TOKEN_COOKIE, token, { ...cookieOpts, maxAge: 12 * 3600 });
    return c.json({ user: userOf(row) });
  });
  app.post("/api/auth/logout", (c) => {
    deleteCookie(c, TOKEN_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  app.use("/api/*", async (c, next) => {
    if (c.req.path.startsWith("/api/auth/login") || c.req.path.startsWith("/api/auth/logout")) return next();
    const token = getCookie(c, TOKEN_COOKIE);
    if (!token) throw new AppError("UNAUTHENTICATED", 401, "請先登入");
    let payload: { sub?: string };
    try {
      payload = (await verify(token, env.jwtSecret, "HS256")) as { sub?: string };
    } catch {
      throw new AppError("UNAUTHENTICATED", 401, "登入已失效，請重新登入");
    }
    const row = db.one<{ id: number; username: string; displayName: string; role: string; status: string }>("SELECT id, username, displayName, role, status FROM User WHERE id = ?", Number(payload.sub));
    if (!row || row.status !== "ACTIVE") throw new AppError("UNAUTHENTICATED", 401, "帳號不可用，請重新登入");
    c.set("user", userOf(row));
    return next();
  });
  app.get("/api/auth/me", (c) => c.json({ user: c.get("user") }));

  const requireAdmin = async (c: { get: (k: "user") => AuthUser }, next: () => Promise<void>) => {
    if (c.get("user").role !== "ADMIN") throw new AppError("FORBIDDEN", 403, "您沒有執行此操作的權限");
    await next();
  };
  const ctxOf = (c: { get: (k: "user") => AuthUser; req: { header: (n: string) => string | undefined } }): stock.Ctx => ({ operator: { id: c.get("user").id }, idempotencyKey: c.req.header("Idempotency-Key")?.slice(0, 128) || undefined });

  // ---------- 使用者（ADMIN） ----------
  const userSelect = "SELECT id, username, displayName, role, status, createdAt FROM User";
  app.get("/api/users", requireAdmin, (c) => {
    const items = db.all(userSelect + " ORDER BY id");
    return c.json({ items, total: items.length });
  });
  app.post("/api/users", requireAdmin, async (c) => {
    const input = z.object({ username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_.-]+$/, "帳號僅能含英數字與 _ . -"), password: z.string().min(6, "密碼至少 6 碼"), displayName: z.string().min(1), role: z.enum(["ADMIN", "STAFF"]) }).parse(await c.req.json());
    if (db.one("SELECT 1 FROM User WHERE username = ?", input.username)) throw new AppError("CONFLICT", 409, `帳號「${input.username}」已存在`);
    const newId = db.insert("INSERT INTO User (username, passwordHash, displayName, role) VALUES (?, ?, ?, ?)", input.username, await hashPassword(input.password), input.displayName, input.role);
    return c.json(db.one(userSelect + " WHERE id = ?", newId), 201);
  });
  app.patch("/api/users/:id", requireAdmin, async (c) => {
    const uid = idParam(c.req.param("id"));
    const input = z.object({ displayName: z.string().min(1).optional(), role: z.enum(["ADMIN", "STAFF"]).optional(), status: z.enum(["ACTIVE", "DISABLED"]).optional(), password: z.string().min(6).optional() }).parse(await c.req.json());
    if (!db.one("SELECT 1 FROM User WHERE id = ?", uid)) throw new AppError("NOT_FOUND", 404, "使用者不存在");
    if (uid === c.get("user").id && (input.status === "DISABLED" || (input.role && input.role !== "ADMIN"))) throw new AppError("CONFLICT", 409, "不可停用或降級自己的帳號");
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const k of ["displayName", "role", "status"] as const) if (input[k] !== undefined) { sets.push(`${k} = ?`); params.push(input[k]); }
    if (input.password) { sets.push("passwordHash = ?"); params.push(await hashPassword(input.password)); }
    if (sets.length) db.run(`UPDATE User SET ${sets.join(", ")}, updatedAt = ? WHERE id = ?`, ...params, new Date().toISOString(), uid);
    return c.json(db.one(userSelect + " WHERE id = ?", uid));
  });

  // ---------- 商品 ----------
  const productSchema = z.object({
    name: z.string().trim().min(1, "商品名稱必填").max(100), category: z.string().trim().max(50).nullable().optional(), unit: z.string().trim().min(1, "計量單位必填").max(20),
    lowStockThreshold: z.number().int().min(0).optional(), expiryAlertDays: z.number().int().min(0).optional(), note: z.string().max(500).nullable().optional(),
  });
  app.get("/api/products", (c) => c.json(q.listProducts(db, { q: c.req.query("q"), includeInactive: c.req.query("includeInactive") === "true" })));
  app.post("/api/products", async (c) => c.json(q.createProduct(db, productSchema.parse(await c.req.json())), 201));
  app.get("/api/products/:id", (c) => c.json(q.getProduct(db, idParam(c.req.param("id")))));
  app.get("/api/products/:id/stock", (c) => c.json(q.getProductStock(db, idParam(c.req.param("id")))));
  app.patch("/api/products/:id", async (c) => c.json(q.updateProduct(db, idParam(c.req.param("id")), productSchema.partial().extend({ status: z.enum(["ACTIVE", "INACTIVE"]).optional() }).parse(await c.req.json()))));

  // ---------- 批次、搜尋、冷凍庫、儲位 ----------
  app.get("/api/batches", (c) => c.json(q.listBatches(db, { productId: c.req.query("productId") ? idParam(c.req.query("productId")!, "productId") : undefined, q: c.req.query("q"), inStockOnly: c.req.query("inStockOnly") === "true" })));
  app.get("/api/batches/:id", (c) => c.json(q.getBatch(db, idParam(c.req.param("id")))));
  app.get("/api/search", (c) => c.json(q.search(db, c.req.query("q") ?? "")));
  app.get("/api/warehouses", (c) => c.json(q.listWarehouses(db)));
  app.get("/api/warehouses/:id/layout", (c) => c.json(q.getLayout(db, idParam(c.req.param("id")))));

  const nonNeg = z.number().int().min(0);
  const size = z.number().int().positive();
  const layoutSchema = z.object({
    version: nonNeg, width: size.optional(), height: size.optional(), layout: z.record(z.unknown()).optional(),
    racks: z.array(z.object({
      id: id.optional(), code: z.string().trim().min(1).max(30), label: z.string().trim().max(50).nullable().optional(), x: nonNeg, y: nonNeg, width: size, height: size, rotation: z.union([z.literal(0), z.literal(90)]).optional(),
      locations: z.array(z.object({ id: id.optional(), code: z.string().trim().min(1).max(30), x: nonNeg, y: nonNeg, width: size, height: size, defaultCapacity: z.number().int().positive().nullable().optional() })),
    })),
  });
  app.put("/api/warehouses/:id/layout", async (c) => c.json(saveLayout(db, idParam(c.req.param("id")), layoutSchema.parse(await c.req.json()))));
  app.delete("/api/racks/:id", (c) => c.json(deleteRack(db, idParam(c.req.param("id")))));
  app.delete("/api/locations/:id", (c) => c.json(deleteLocation(db, idParam(c.req.param("id")))));
  app.get("/api/locations/:id", (c) => c.json(q.getLocationDetail(db, idParam(c.req.param("id")))));
  app.get("/api/locations/:id/capacities", (c) => {
    const d = q.getLocationDetail(db, idParam(c.req.param("id")));
    return c.json({ locationId: d.location.id, defaultCapacity: d.location.defaultCapacity, items: d.capacities });
  });
  app.put("/api/locations/:id/capacities", async (c) => {
    const input = z.object({ defaultCapacity: z.number().int().positive().nullable().optional(), items: z.array(z.object({ productId: id, capacity: z.number().int().positive() })).optional() }).parse(await c.req.json());
    return c.json(stock.setCapacities(db, idParam(c.req.param("id")), input, { operator: { id: c.get("user").id } }));
  });

  // ---------- 庫存交易 ----------
  app.post("/api/stock/inbound", async (c) => {
    const input = z.object({ productId: id, quantity: positiveInt, expiryDate: dateString, receivedDate: dateString.optional(), note: z.string().max(500).nullable().optional(), allocations: z.array(z.object({ locationId: id, quantity: positiveInt })).min(1, "至少分配一個儲位") }).parse(await c.req.json());
    return c.json(stock.inbound(db, input, ctxOf(c)), 201);
  });
  app.post("/api/stock/outbound/suggest", async (c) => {
    const { productId, quantity } = z.object({ productId: id, quantity: positiveInt }).parse(await c.req.json());
    return c.json(stock.suggestFefo(db, productId, quantity));
  });
  app.post("/api/stock/outbound", async (c) => {
    const input = z.object({ productId: id, lines: z.array(z.object({ batchId: id, locationId: id, quantity: positiveInt })).min(1, "至少一筆出庫明細"), note: z.string().max(500).nullable().optional() }).parse(await c.req.json());
    return c.json(stock.outbound(db, input, ctxOf(c)), 201);
  });
  app.post("/api/stock/transfer", async (c) => {
    const input = z.object({ batchId: id, fromLocationId: id, toLocationId: id, quantity: positiveInt, note: z.string().max(500).nullable().optional() }).parse(await c.req.json());
    return c.json(stock.transfer(db, input, ctxOf(c)), 201);
  });
  app.post("/api/stock/damage", async (c) => {
    const input = z.object({ batchId: id, locationId: id, quantity: positiveInt, reason: z.string().trim().min(1, "請填寫報損原因").max(500) }).parse(await c.req.json());
    return c.json(stock.damage(db, input, ctxOf(c)), 201);
  });

  // ---------- 異動紀錄 ----------
  app.get("/api/movements", (c) => {
    const s = z.object({
      type: z.enum(["IN", "OUT", "TRANSFER", "DAMAGE", "ADJUSTMENT"]).optional(), productId: z.coerce.number().int().positive().optional(), batchId: z.coerce.number().int().positive().optional(), locationId: z.coerce.number().int().positive().optional(),
      dateFrom: dateString.optional(), dateTo: dateString.optional(), limit: z.coerce.number().int().min(1).max(500).default(100), offset: z.coerce.number().int().min(0).default(0),
    }).parse(c.req.query());
    return c.json(q.listMovements(db, s));
  });

  // ---------- 盤點 ----------
  app.get("/api/stocktakes", (c) => c.json(q.listStocktakes(db, z.enum(["PENDING", "APPROVED", "REJECTED"]).optional().parse(c.req.query("status")))));
  app.get("/api/stocktakes/baseline", (c) => c.json({ items: q.stocktakeBaseline(db, c.req.query("warehouseId") ? idParam(c.req.query("warehouseId")!, "warehouseId") : undefined) }));
  app.post("/api/stocktakes", async (c) => {
    const input = z.object({ warehouseId: id.optional(), note: z.string().max(500).nullable().optional(), items: z.array(z.object({ locationId: id, batchId: id, countedQty: z.number().int().min(0) })).min(1, "至少一筆盤點明細") }).parse(await c.req.json());
    return c.json(q.submitStocktake(db, input, c.get("user").id), 201);
  });
  app.get("/api/stocktakes/:id", (c) => c.json(q.getStocktake(db, idParam(c.req.param("id")))));
  const reviewSchema = z.object({ note: z.string().max(500).nullable().optional() });
  app.post("/api/stocktakes/:id/approve", requireAdmin, async (c) => c.json(stock.approveStocktake(db, idParam(c.req.param("id")), reviewSchema.parse(await c.req.json().catch(() => ({}))).note ?? null, ctxOf(c))));
  app.post("/api/stocktakes/:id/reject", requireAdmin, async (c) => c.json(stock.rejectStocktake(db, idParam(c.req.param("id")), reviewSchema.parse(await c.req.json().catch(() => ({}))).note ?? null, { operator: { id: c.get("user").id } })));

  // ---------- Dashboard ----------
  app.get("/api/dashboard", (c) => c.json(q.getDashboard(db)));

  // ---------- 展示用：重置成初始示範資料（僅 ADMIN；清空全部庫存與紀錄後重新 seed） ----------
  app.post("/api/admin/reset-demo", requireAdmin, async (c) => {
    const { confirm } = z.object({ confirm: z.literal("RESET") }).parse(await c.req.json());
    void confirm;
    const result = await env.resetDemo();
    return c.json(result);
  });

  app.notFound((c) => c.json({ error: { code: "NOT_FOUND", message: "找不到此 API" } }, 404));
  return app;
}

export { randomHex };
