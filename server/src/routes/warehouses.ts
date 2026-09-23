import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { notFound } from "../lib/errors.js";
import { idParam } from "../middleware/validate.js";

/** Stage 1：唯讀布局。Stage 3 加入 PUT /:id/layout 與刪除。 */
export const warehousesRouter = Router();

warehousesRouter.get("/", async (_req, res, next) => {
  try {
    const warehouses = await prisma.warehouse.findMany({
      orderBy: { code: "asc" },
      include: { racks: { where: { status: "ACTIVE" }, select: { id: true, locations: { where: { status: "ACTIVE" }, select: { id: true } } } } },
    });
    const items = warehouses.map(({ racks, layoutJson, ...w }) => ({
      ...w,
      rackCount: racks.length,
      locationCount: racks.reduce((s, r) => s + r.locations.length, 0),
    }));
    res.json({ items, total: items.length });
  } catch (err) {
    next(err);
  }
});

warehousesRouter.get("/:id/layout", async (req, res, next) => {
  try {
    const id = idParam(req);
    const w = await prisma.warehouse.findUnique({
      where: { id },
      include: {
        racks: {
          where: { status: "ACTIVE" },
          orderBy: { code: "asc" },
          include: {
            locations: {
              where: { status: "ACTIVE" },
              orderBy: { code: "asc" },
              include: { inventories: { where: { quantity: { gt: 0 } }, include: { batch: { select: { productId: true, product: { select: { name: true, unit: true } } } } } } },
            },
          },
        },
      },
    });
    if (!w) throw notFound("冷凍庫");
    const { racks, layoutJson, ...rest } = w;
    res.json({
      ...rest,
      layout: JSON.parse(layoutJson || "{}"),
      racks: racks.map((r) => ({
        ...r,
        locations: r.locations.map(({ inventories, ...loc }) => {
          const quantity = inventories.reduce((s, i) => s + i.quantity, 0);
          const first = inventories[0]?.batch;
          return {
            ...loc,
            occupied: quantity > 0,
            quantity,
            batchCount: inventories.length,
            product: first ? { id: first.productId, name: first.product.name, unit: first.product.unit } : null,
          };
        }),
      })),
    });
  } catch (err) {
    next(err);
  }
});
