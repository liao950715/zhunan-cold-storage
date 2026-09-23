import { Router } from "express";
import { z } from "zod";
import { idParam, parseBody, parseQuery } from "../middleware/validate.js";
import { createProduct, getProduct, listProducts, updateProduct } from "../services/productService.js";
import { getProductStock } from "../services/stockQueryService.js";

export const productsRouter = Router();

const listQuery = z.object({
  q: z.string().optional(),
  includeInactive: z.enum(["true", "false"]).optional(),
});

const baseSchema = z.object({
  name: z.string().trim().min(1, "商品名稱必填").max(100),
  category: z.string().trim().max(50).nullable().optional(),
  unit: z.string().trim().min(1, "計量單位必填").max(20),
  lowStockThreshold: z.number().int().min(0).optional(),
  expiryAlertDays: z.number().int().min(0).optional(),
  note: z.string().max(500).nullable().optional(),
});

productsRouter.get("/", async (req, res, next) => {
  try {
    const q = parseQuery(listQuery, req);
    res.json(await listProducts({ q: q.q, includeInactive: q.includeInactive === "true" }));
  } catch (err) {
    next(err);
  }
});

productsRouter.post("/", async (req, res, next) => {
  try {
    res.status(201).json(await createProduct(parseBody(baseSchema, req)));
  } catch (err) {
    next(err);
  }
});

productsRouter.get("/:id", async (req, res, next) => {
  try {
    res.json(await getProduct(idParam(req)));
  } catch (err) {
    next(err);
  }
});

productsRouter.get("/:id/stock", async (req, res, next) => {
  try {
    res.json(await getProductStock(idParam(req)));
  } catch (err) {
    next(err);
  }
});

productsRouter.patch("/:id", async (req, res, next) => {
  try {
    const input = parseBody(baseSchema.partial().extend({ status: z.enum(["ACTIVE", "INACTIVE"]).optional() }), req);
    res.json(await updateProduct(idParam(req), input));
  } catch (err) {
    next(err);
  }
});
