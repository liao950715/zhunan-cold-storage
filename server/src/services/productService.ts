import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { AppError, notFound } from "../lib/errors.js";

export interface ProductInput {
  name: string;
  category?: string | null;
  unit: string;
  lowStockThreshold?: number;
  expiryAlertDays?: number;
  note?: string | null;
}

export async function listProducts(opts: { q?: string; includeInactive?: boolean }) {
  const where: Prisma.ProductWhereInput = {};
  if (!opts.includeInactive) where.status = "ACTIVE";
  if (opts.q) where.name = { contains: opts.q };
  const items = await prisma.product.findMany({ where, orderBy: { name: "asc" } });
  return { items, total: items.length };
}

export async function getProduct(id: number) {
  const p = await prisma.product.findUnique({ where: { id } });
  if (!p) throw notFound("商品");
  return p;
}

export async function createProduct(input: ProductInput) {
  const exists = await prisma.product.findUnique({ where: { name: input.name } });
  if (exists) throw new AppError("CONFLICT", 409, `商品名稱「${input.name}」已存在`);
  return prisma.product.create({ data: input });
}

/** 已有批次的商品不可改單位（UNIT_LOCKED），改名允許（歷史用 id 關聯）。 */
export async function updateProduct(id: number, input: Partial<ProductInput> & { status?: "ACTIVE" | "INACTIVE" }) {
  const p = await getProduct(id);
  if (input.unit !== undefined && input.unit !== p.unit) {
    const batchCount = await prisma.batch.count({ where: { productId: id } });
    if (batchCount > 0) {
      throw new AppError("UNIT_LOCKED", 409, `商品「${p.name}」已有 ${batchCount} 個批次，計量單位不可再修改`);
    }
  }
  if (input.name !== undefined && input.name !== p.name) {
    const dup = await prisma.product.findUnique({ where: { name: input.name } });
    if (dup) throw new AppError("CONFLICT", 409, `商品名稱「${input.name}」已存在`);
  }
  return prisma.product.update({ where: { id }, data: input });
}
