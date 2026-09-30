import { expect, type Page } from "@playwright/test";
import { api, locationIdByCode, productByName } from "../e2e/helpers";

/** 示範站公開的示範帳號（README、登入頁都有列） */
const ACCOUNTS = { admin: ["admin", "admin1234"], staff: ["staff", "staff1234"] } as const;

/** 示範站免同步碼：直接到登入頁登入（走真正的 UI）。 */
export async function login(page: Page, who: keyof typeof ACCOUNTS) {
  await page.goto("/login");
  await page.getByLabel("帳號").fill(ACCOUNTS[who][0]);
  await page.getByLabel("密碼", { exact: true }).fill(ACCOUNTS[who][1]);
  await page.getByRole("button", { name: "登入" }).click();
  await expect(page.getByRole("heading", { name: "首頁" })).toBeVisible();
}

/** 某儲位目前的占用量（透過 API，帶同一個瀏覽器的 cookie → 同一份示範資料） */
export async function occupied(page: Page, code: string) {
  return (await api<{ occupied: number }>(page, "GET", `/locations/${await locationIdByCode(page, code)}`)).occupied;
}

/** 用 API 快速做一筆入庫（讓這份示範資料「被改過」） */
export async function quickInbound(page: Page, code: string, quantity: number) {
  const p = await productByName(page, "甘藍菜");
  await api(page, "POST", "/stock/inbound", { productId: p.id, quantity, expiryDate: "2099-12-31", allocations: [{ locationId: await locationIdByCode(page, code), quantity }] });
}

export const demoNote = (page: Page) => page.getByRole("note", { name: "示範站說明" });
