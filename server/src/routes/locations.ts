import { Router } from "express";
import { z } from "zod";
import { idParam, parseBody } from "../middleware/validate.js";
import { getLocationDetail } from "../services/stockQueryService.js";
import { setCapacities } from "../services/stockService.js";

/** 儲位詳情與容量設定。Stage 3 加刪除。 */
export const locationsRouter = Router();

locationsRouter.get("/:id", async (req, res, next) => {
  try {
    res.json(await getLocationDetail(idParam(req)));
  } catch (err) {
    next(err);
  }
});

const capacitySchema = z.object({
  defaultCapacity: z.number().int().positive().nullable().optional(),
  items: z.array(z.object({ productId: z.number().int().positive(), capacity: z.number().int().positive() })).optional(),
});

locationsRouter.get("/:id/capacities", async (req, res, next) => {
  try {
    const d = await getLocationDetail(idParam(req));
    res.json({ locationId: d.location.id, defaultCapacity: d.location.defaultCapacity, items: d.capacities });
  } catch (err) {
    next(err);
  }
});

locationsRouter.put("/:id/capacities", async (req, res, next) => {
  try {
    res.json(await setCapacities(idParam(req), parseBody(capacitySchema, req), { operator: { id: req.user!.id } }));
  } catch (err) {
    next(err);
  }
});
