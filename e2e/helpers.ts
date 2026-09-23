import { expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

export const SYNC_CODE = (() => {
  const m = /SYNC_SECRET=(.+)/.exec(readFileSync("worker/.dev.vars", "utf8"));
  return m?.[1].trim() ?? "";
})();
export const ACCOUNTS = { admin: { username: "admin", password: "admin1234" }, staff: { username: "staff", password: "staff1234" } };

/** 配對＋登入（走真正的 UI）。 */
export async function pairAndLogin(page: Page, who: keyof typeof ACCOUNTS) {
  await page.goto("/pair");
  await page.getByLabel("同步碼").fill(SYNC_CODE);
  await page.getByRole("button", { name: "配對這台裝置" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("帳號").fill(ACCOUNTS[who].username);
  await page.getByLabel("密碼").fill(ACCOUNTS[who].password);
  await page.getByRole("button", { name: "登入" }).click();
  await expect(page.getByRole("heading", { name: "首頁" })).toBeVisible();
}

/** 用同一個瀏覽器 context 的 cookie 呼叫 API（測試前置／驗證用）。 */
export async function api<T = any>(page: Page, method: "GET" | "POST" | "PUT" | "DELETE", path: string, data?: unknown): Promise<T> {
  const res = await page.request.fetch(`/api${path}`, { method, data });
  const body = await res.json().catch(() => ({}));
  if (!res.ok()) throw new Error(`${method} ${path} → ${res.status()} ${JSON.stringify(body)}`);
  return body as T;
}

/** 以管理員身分重置成示範資料（每個測試檔開始前）。 */
export async function resetDemo(page: Page) {
  await pairAndLogin(page, "admin");
  await api(page, "POST", "/admin/reset-demo", { confirm: "RESET" });
  await api(page, "POST", "/auth/logout");
}

export async function locationIdByCode(page: Page, code: string): Promise<number> {
  const whs = await api<{ items: Array<{ id: number }> }>(page, "GET", "/warehouses");
  for (const w of whs.items) {
    const l = await api<{ racks: Array<{ locations: Array<{ id: number; code: string }> }> }>(page, "GET", `/warehouses/${w.id}/layout`);
    for (const r of l.racks) for (const loc of r.locations) if (loc.code === code) return loc.id;
  }
  throw new Error(`location ${code} not found`);
}

export async function productByName(page: Page, name: string) {
  const r = await api<{ items: Array<{ id: number; name: string; unit: string }> }>(page, "GET", `/products?q=${encodeURIComponent(name)}`);
  const p = r.items.find((x) => x.name === name);
  if (!p) throw new Error(`product ${name} not found`);
  return p;
}

/** 在 Konva 平面圖上點某個儲位：依 layout 幾何換算成畫布座標。 */
export async function clickCell(page: Page, code: string, canvasIndex = 0) {
  const whs = await api<{ items: Array<{ id: number; width: number }> }>(page, "GET", "/warehouses");
  let target: { x: number; y: number; w: number; h: number; W: number } | null = null;
  for (const w of whs.items) {
    const l = await api<{ width: number; racks: Array<{ x: number; y: number; locations: Array<{ code: string; x: number; y: number; width: number; height: number }> }> }>(page, "GET", `/warehouses/${w.id}/layout`);
    for (const r of l.racks) for (const loc of r.locations) if (loc.code === code) target = { x: r.x + loc.x, y: r.y + loc.y, w: loc.width, h: loc.height, W: l.width };
  }
  if (!target) throw new Error(`cell ${code} not found`);
  const canvas = page.locator(".konvajs-content canvas").nth(canvasIndex * 2); // 每個 Stage 有 2 個 layer canvas
  const box = await canvas.boundingBox();
  if (!box) throw new Error("canvas not visible");
  const scale = box.width / target.W;
  await page.mouse.click(box.x + (target.x + target.w / 2) * scale, box.y + (target.y + target.h / 2) * scale);
}

/** 依選項文字（包含比對）選 select。 */
export async function selectByText(select: import("@playwright/test").Locator, text: string) {
  await select.locator("option", { hasText: text }).first().waitFor({ state: "attached", timeout: 15_000 }); // 等清單載入
  const value = await select.evaluate((el: HTMLSelectElement, t: string) => {
    const o = [...el.options].find((x) => x.text.includes(t));
    return o?.value ?? null;
  }, text);
  if (value === null) throw new Error(`option containing "${text}" not found`);
  await select.selectOption(value);
}
