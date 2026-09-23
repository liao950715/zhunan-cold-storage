import { Router } from "express";
import { z } from "zod";
import { parseQuery } from "../middleware/validate.js";
import { search } from "../services/searchService.js";

export const searchRouter = Router();

searchRouter.get("/", async (req, res, next) => {
  try {
    const { q } = parseQuery(z.object({ q: z.string().default("") }), req);
    res.json(await search(q));
  } catch (err) {
    next(err);
  }
});
