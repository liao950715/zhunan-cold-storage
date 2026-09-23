import request from "supertest";
import type { Express } from "express";
import { prisma } from "../lib/prisma.js";
import { seedBase, DEMO_ACCOUNTS } from "../../prisma/seed.js";

/** 清空所有表（依 FK 順序）後重新 seed 基本資料。 */
export async function resetDb() {
  await prisma.$transaction([
    prisma.idempotencyKey.deleteMany(),
    prisma.stocktakeItem.deleteMany(),
    prisma.stocktake.deleteMany(),
    prisma.stockMovement.deleteMany(),
    prisma.inventory.deleteMany(),
    prisma.locationCapacity.deleteMany(),
    prisma.batch.deleteMany(),
    prisma.batchCounter.deleteMany(),
    prisma.location.deleteMany(),
    prisma.rack.deleteMany(),
    prisma.warehouse.deleteMany(),
    prisma.product.deleteMany(),
    prisma.user.deleteMany(),
  ]);
  await seedBase(prisma);
}

/** 登入並回傳 cookie 字串，供後續請求使用。 */
export async function loginAs(app: Express, who: keyof typeof DEMO_ACCOUNTS) {
  const a = DEMO_ACCOUNTS[who];
  const res = await request(app).post("/api/auth/login").send({ username: a.username, password: a.password });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  const cookie = res.headers["set-cookie"];
  return Array.isArray(cookie) ? cookie.join("; ") : String(cookie);
}

export const byCode = (code: string) => prisma.location.findUniqueOrThrow({ where: { code } });
export const productByName = (name: string) => prisma.product.findUniqueOrThrow({ where: { name } });
