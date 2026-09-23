import { Router } from "express";
import { z } from "zod";
import { requireRole } from "../middleware/auth.js";
import { idParam, parseBody, parseQuery } from "../middleware/validate.js";
import { getStocktake, listStocktakes, stocktakeBaseline, submitStocktake } from "../services/stocktakeService.js";
import { approveStocktake, rejectStocktake } from "../services/stockService.js";

export const stocktakesRouter = Router();

const submitSchema = z.object({
  warehouseId: z.number().int().positive().optional(),
  note: z.string().max(500).nullable().optional(),
  items: z.array(z.object({ locationId: z.number().int().positive(), batchId: z.number().int().positive(), countedQty: z.number().int().min(0) })).min(1, "至少一筆盤點明細"),
});
const reviewSchema = z.object({ note: z.string().max(500).nullable().optional() });

stocktakesRouter.get("/", async (req, res, next) => {
  try {
    const { status } = parseQuery(z.object({ status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional() }), req);
    res.json(await listStocktakes(status));
  } catch (err) {
    next(err);
  }
});

stocktakesRouter.get("/baseline", async (req, res, next) => {
  try {
    const { warehouseId } = parseQuery(z.object({ warehouseId: z.coerce.number().int().positive().optional() }), req);
    res.json({ items: await stocktakeBaseline(warehouseId) });
  } catch (err) {
    next(err);
  }
});

stocktakesRouter.post("/", async (req, res, next) => {
  try {
    res.status(201).json(await submitStocktake(parseBody(submitSchema, req), req.user!.id));
  } catch (err) {
    next(err);
  }
});

stocktakesRouter.get("/:id", async (req, res, next) => {
  try {
    res.json(await getStocktake(idParam(req)));
  } catch (err) {
    next(err);
  }
});

// 僅管理員（後端強制，AT-22）
stocktakesRouter.post("/:id/approve", requireRole("ADMIN"), async (req, res, next) => {
  try {
    const { note } = parseBody(reviewSchema, req);
    res.json(await approveStocktake(idParam(req), note ?? null, { operator: { id: req.user!.id }, idempotencyKey: req.header("Idempotency-Key") || undefined }));
  } catch (err) {
    next(err);
  }
});

stocktakesRouter.post("/:id/reject", requireRole("ADMIN"), async (req, res, next) => {
  try {
    const { note } = parseBody(reviewSchema, req);
    res.json(await rejectStocktake(idParam(req), note ?? null, { operator: { id: req.user!.id } }));
  } catch (err) {
    next(err);
  }
});
