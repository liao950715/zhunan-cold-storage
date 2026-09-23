import { Router } from "express";
import { z } from "zod";
import { idParam, parseBody } from "../middleware/validate.js";
import { deleteLocation, deleteRack, saveLayout } from "../services/layoutService.js";

const nonNeg = z.number().int().min(0);
const size = z.number().int().positive();

const locationSchema = z.object({
  id: z.number().int().positive().optional(),
  code: z.string().trim().min(1).max(30),
  x: nonNeg, y: nonNeg, width: size, height: size,
  defaultCapacity: z.number().int().positive().nullable().optional(),
});

const rackSchema = z.object({
  id: z.number().int().positive().optional(),
  code: z.string().trim().min(1).max(30),
  label: z.string().trim().max(50).nullable().optional(),
  x: nonNeg, y: nonNeg, width: size, height: size,
  rotation: z.union([z.literal(0), z.literal(90)]).optional(),
  locations: z.array(locationSchema),
});

export const layoutSchema = z.object({
  version: nonNeg,
  width: size.optional(),
  height: size.optional(),
  layout: z.record(z.unknown()).optional(),
  racks: z.array(rackSchema),
});

/** 掛在 /api/warehouses/:id/layout（PUT） */
export const warehouseLayoutRouter = Router({ mergeParams: true });
warehouseLayoutRouter.put("/", async (req, res, next) => {
  try {
    res.json(await saveLayout(idParam(req), parseBody(layoutSchema, req)));
  } catch (err) {
    next(err);
  }
});

export const racksRouter = Router();
racksRouter.delete("/:id", async (req, res, next) => {
  try {
    res.json(await deleteRack(idParam(req)));
  } catch (err) {
    next(err);
  }
});

export const locationDeleteRouter = Router();
locationDeleteRouter.delete("/:id", async (req, res, next) => {
  try {
    res.json(await deleteLocation(idParam(req)));
  } catch (err) {
    next(err);
  }
});
