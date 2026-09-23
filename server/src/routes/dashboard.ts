import { Router } from "express";
import { getDashboard } from "../services/dashboardService.js";

export const dashboardRouter = Router();

dashboardRouter.get("/", async (_req, res, next) => {
  try {
    res.json(await getDashboard());
  } catch (err) {
    next(err);
  }
});
