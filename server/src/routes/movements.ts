import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { dateString, parseDate } from "../lib/dates.js";
import { parseQuery } from "../middleware/validate.js";

/** FR-016 異動紀錄查詢（唯讀，無修改／刪除 API）。 */
export const movementsRouter = Router();

const query = z.object({
  type: z.enum(["IN", "OUT", "TRANSFER", "DAMAGE", "ADJUSTMENT"]).optional(),
  productId: z.coerce.number().int().positive().optional(),
  batchId: z.coerce.number().int().positive().optional(),
  locationId: z.coerce.number().int().positive().optional(),
  dateFrom: dateString.optional(),
  dateTo: dateString.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

movementsRouter.get("/", async (req, res, next) => {
  try {
    const q = parseQuery(query, req);
    const where = {
      type: q.type,
      productId: q.productId,
      batchId: q.batchId,
      ...(q.locationId ? { OR: [{ fromLocationId: q.locationId }, { toLocationId: q.locationId }] } : {}),
      createdAt: {
        gte: q.dateFrom ? parseDate(q.dateFrom) : undefined,
        lt: q.dateTo ? new Date(parseDate(q.dateTo).getTime() + 86_400_000) : undefined,
      },
    };
    const [items, total] = await Promise.all([
      prisma.stockMovement.findMany({
        where,
        include: {
          batch: { select: { batchNo: true } },
          product: { select: { name: true, unit: true } },
          fromLocation: { select: { code: true } },
          toLocation: { select: { code: true } },
          operator: { select: { id: true, displayName: true } },
        },
        orderBy: { id: "desc" },
        take: q.limit,
        skip: q.offset,
      }),
      prisma.stockMovement.count({ where }),
    ]);
    res.json({ items, total });
  } catch (err) {
    next(err);
  }
});
