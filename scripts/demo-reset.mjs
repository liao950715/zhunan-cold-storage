// 展示前一鍵重置：把指定站台的資料重置成初始示範資料。
// 用法：node scripts/demo-reset.mjs [BASE_URL]
//   環境變數 SYNC_CODE（同步碼）、ADMIN_USER／ADMIN_PASS（預設 admin/admin1234）
//   本機未給 SYNC_CODE 時會讀 worker/.dev.vars。
import { readFileSync } from "node:fs";

const base = (process.argv[2] || "http://localhost:8787").replace(/\/$/, "");
let sync = process.env.SYNC_CODE;
if (!sync && base.includes("localhost")) sync = /SYNC_SECRET=(.+)/.exec(readFileSync("worker/.dev.vars", "utf8"))?.[1].trim();
if (!sync) { console.error("請提供 SYNC_CODE 環境變數（同步碼）"); process.exit(1); }

const jar = new Map();
const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
async function call(path, body) {
  const res = await fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookieHeader() }, body: JSON.stringify(body) });
  for (const sc of res.headers.getSetCookie?.() ?? []) { const [k, v] = sc.split(";")[0].split("="); jar.set(k.trim(), v); }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} → ${res.status} ${JSON.stringify(json)}`);
  return json;
}
await call("/api/pair", { code: sync });
await call("/api/auth/login", { username: process.env.ADMIN_USER || "admin", password: process.env.ADMIN_PASS || "admin1234" });
await call("/api/admin/reset-demo", { confirm: "RESET" });
console.log(`已重置 ${base} 為初始示範資料（帳號、兩座冷凍庫、20 種商品、4 批示範庫存）`);
