import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { notFound } from "../lib/errors.js";
import { formatDate } from "../lib/dates.js";
import { idParam, parseQuery } from "../middleware/validate.js";
import { toStockLine } from "../services/stockQueryService.js";

export const batchesRouter = Router();

const listQuery = z.object({
  productId: z.coerce.number().int().positive().optional(),
  q: z.string().optional(),
  inStockOnly: z.enum(["true", "false"]).optional(),
});

function serialize(b: { receivedDate: Date; expiryDate: Date } & Record<string, unknown>) {
  return { ...b, receivedDate: formatDate(b.receivedDate), expiryDate: formatDate(b.expiryDate) };
}

batchesRouter.get("/", async (req, res, next) => {
  try {
    const q = parseQuery(listQuery, req);
    const batches = await prisma.batch.findMany({
      where: {
        productId: q.productId,
        batchNo: q.q ? { contains: q.q } : undefined,
        inventories: q.inStockOnly === "true" ? { some: { quantity: { gt: 0 } } } : undefined,
      },
      include: { product: { select: { id: true, name: true, unit: true } }, inventories: { select: { quantity: true } } },
      orderBy: [{ expiryDate: "asc" }, { batchNo: "asc" }],
    });
    const items = batches.map(({ inventories, ...b }) => ({
      ...serialize(b),
      available: inventories.reduce((s, i) => s + i.quantity, 0),
    }));
    res.json({ items, total: items.length });
  } catch (err) {
    next(err);
  }
});

batchesRouter.get("/:id", async (req, res, next) => {
  try {
    const id = idParam(req);
    const batch = await prisma.batch.findUnique({ where: { id }, include: { product: true, createdBy: { select: { id: true, displayName: true } } } });
    if (!batch) throw notFound("批次");
    const rows = await prisma.inventory.findMany({
      where: { batchId: id, quantity: { gt: 0 } },
      include: { batch: { include: { product: true } }, location: { include: { rack: { include: { warehouse: true } } } } },
      orderBy: { location: { code: "asc" } },
    });
    const lines = rows.map(toStockLine);
    res.json({ ...serialize(batch), available: lines.reduce((s, l) => s + l.quantity, 0), lines });
  } catch (err) {
    next(err);
  }
});
