import { Router } from "express";
import { z } from "zod";
import { dateString } from "../lib/dates.js";
import { parseBody } from "../middleware/validate.js";
import { damage, inbound, outbound, suggestFefo, transfer } from "../services/stockService.js";

export const stockRouter = Router();

const positiveInt = z.number().int().positive("數量必須是正整數");
const id = z.number().int().positive();

const inboundSchema = z.object({
  productId: id,
  quantity: positiveInt,
  expiryDate: dateString,
  receivedDate: dateString.optional(),
  note: z.string().max(500).nullable().optional(),
  allocations: z.array(z.object({ locationId: id, quantity: positiveInt })).min(1, "至少分配一個儲位"),
});

const outboundSchema = z.object({
  productId: id,
  lines: z.array(z.object({ batchId: id, locationId: id, quantity: positiveInt })).min(1, "至少一筆出庫明細"),
  note: z.string().max(500).nullable().optional(),
});

const transferSchema = z.object({ batchId: id, fromLocationId: id, toLocationId: id, quantity: positiveInt, note: z.string().max(500).nullable().optional() });
const damageSchema = z.object({ batchId: id, locationId: id, quantity: positiveInt, reason: z.string().trim().min(1, "請填寫報損原因").max(500) });
const suggestSchema = z.object({ productId: id, quantity: positiveInt });

const ctxOf = (req: Parameters<Parameters<typeof stockRouter.post>[1]>[0]) => ({
  operator: { id: req.user!.id },
  idempotencyKey: (req.header("Idempotency-Key") || undefined)?.slice(0, 128),
});

stockRouter.post("/inbound", async (req, res, next) => {
  try {
    res.status(201).json(await inbound(parseBody(inboundSchema, req), ctxOf(req)));
  } catch (err) {
    next(err);
  }
});

stockRouter.post("/outbound/suggest", async (req, res, next) => {
  try {
    const { productId, quantity } = parseBody(suggestSchema, req);
    res.json(await suggestFefo(productId, quantity));
  } catch (err) {
    next(err);
  }
});

stockRouter.post("/outbound", async (req, res, next) => {
  try {
    res.status(201).json(await outbound(parseBody(outboundSchema, req), ctxOf(req)));
  } catch (err) {
    next(err);
  }
});

stockRouter.post("/transfer", async (req, res, next) => {
  try {
    res.status(201).json(await transfer(parseBody(transferSchema, req), ctxOf(req)));
  } catch (err) {
    next(err);
  }
});

stockRouter.post("/damage", async (req, res, next) => {
  try {
    res.status(201).json(await damage(parseBody(damageSchema, req), ctxOf(req)));
  } catch (err) {
    next(err);
  }
});
