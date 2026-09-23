import { SELF } from "cloudflare:test";
import { expect } from "vitest";

/** 測試用 HTTP 小工具：模擬 supertest 的 `.expect(status)`；cookie 自動累積（配對 + 登入）。 */
export interface Res<T = any> { status: number; body: T; headers: Headers }

export class Client {
  private cookies = new Map<string, string>();

  private cookieHeader() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  request<T = any>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const p = (async (): Promise<Res<T>> => {
      const res = await SELF.fetch(`http://test${path}`, {
        method,
        headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), Cookie: this.cookieHeader(), ...headers },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      for (const sc of res.headers.getSetCookie?.() ?? []) {
        const [pair, ...attrs] = sc.split(";");
        const [k, v] = pair.split("=");
        if (attrs.some((a) => /max-age=0/i.test(a))) this.cookies.delete(k.trim());
        else this.cookies.set(k.trim(), v);
      }
      const text = await res.text();
      let json: T = undefined as T;
      try { json = JSON.parse(text); } catch { /* non-json */ }
      return { status: res.status, body: json, headers: res.headers };
    })();
    return Object.assign(p, {
      expect: async (status: number) => {
        const r = await p;
        expect(r.status, `${method} ${path} → ${JSON.stringify(r.body)}`).toBe(status);
        return r;
      },
    });
  }
  get<T = any>(path: string) { return this.request<T>("GET", path); }
  post<T = any>(path: string, body?: unknown, headers?: Record<string, string>) { return this.request<T>("POST", path, body ?? {}, headers); }
  put<T = any>(path: string, body?: unknown) { return this.request<T>("PUT", path, body); }
  patch<T = any>(path: string, body?: unknown) { return this.request<T>("PATCH", path, body); }
  delete<T = any>(path: string) { return this.request<T>("DELETE", path); }
}

export const SYNC_CODE = "test-sync-code-0123456789";
export const ACCOUNTS = { admin: { username: "admin", password: "admin1234" }, staff: { username: "staff", password: "staff1234" } };

/** 配對＋登入，回傳已帶 cookie 的 client。 */
export async function loginAs(who: keyof typeof ACCOUNTS) {
  const c = new Client();
  await c.post("/api/pair", { code: SYNC_CODE }).expect(200);
  await c.post("/api/auth/login", ACCOUNTS[who]).expect(200);
  return c;
}
export async function pairedClient() {
  const c = new Client();
  await c.post("/api/pair", { code: SYNC_CODE }).expect(200);
  return c;
}

/** 常用查詢（透過 API） */
export async function productByName(c: Client, name: string) {
  const r = await c.get(`/api/products?q=${encodeURIComponent(name)}&includeInactive=true`);
  const p = r.body.items.find((x: { name: string }) => x.name === name);
  if (!p) throw new Error(`product ${name} not found`);
  return p as { id: number; name: string; unit: string };
}
export async function locationIdByCode(c: Client, code: string) {
  const whs = await c.get("/api/warehouses");
  for (const w of whs.body.items) {
    const l = await c.get(`/api/warehouses/${w.id}/layout`);
    for (const r of l.body.racks) for (const loc of r.locations) if (loc.code === code) return loc.id as number;
  }
  throw new Error(`location ${code} not found`);
}
export async function productTotal(c: Client, productId: number) {
  return (await c.get(`/api/products/${productId}/stock`)).body.total as number;
}
export async function locQty(c: Client, locationId: number) {
  return (await c.get(`/api/locations/${locationId}`)).body.occupied as number;
}
export async function movements(c: Client, query = "") {
  return (await c.get(`/api/movements?limit=500${query}`)).body as { items: any[]; total: number };
}
/** 快照：所有商品庫存明細＋異動筆數，用來斷言「無部分更新」。 */
export async function snapshot(c: Client) {
  const whs = await c.get("/api/warehouses");
  const locs: unknown[] = [];
  for (const w of whs.body.items) locs.push((await c.get(`/api/warehouses/${w.id}/layout`)).body.racks.map((r: any) => r.locations.map((l: any) => [l.code, l.quantity, l.product?.id])));
  return { locs, mov: (await movements(c)).total, batches: (await c.get("/api/batches")).body.total };
}
