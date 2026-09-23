import { Router } from "express";
import { idParam } from "../middleware/validate.js";
import { getLocationDetail } from "../services/stockQueryService.js";

/** Stage 1：儲位詳情。Stage 2 加容量設定、Stage 3 加刪除。 */
export const locationsRouter = Router();

locationsRouter.get("/:id", async (req, res, next) => {
  try {
    res.json(await getLocationDetail(idParam(req)));
  } catch (err) {
    next(err);
  }
});
