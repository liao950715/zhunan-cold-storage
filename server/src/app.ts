import express from "express";
import cookieParser from "cookie-parser";
import { authenticate, requireRole } from "./middleware/auth.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { authRouter } from "./routes/auth.js";
import { usersRouter } from "./routes/users.js";
import { productsRouter } from "./routes/products.js";
import { batchesRouter } from "./routes/batches.js";
import { warehousesRouter } from "./routes/warehouses.js";
import { locationsRouter } from "./routes/locations.js";
import { searchRouter } from "./routes/search.js";
import { stockRouter } from "./routes/stock.js";
import { movementsRouter } from "./routes/movements.js";

/** 建立 Express app（不 listen），供 index.ts 與 Supertest 共用。 */
export function createApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", service: "zhunan-cold-storage", stage: 2});
  });

  app.use("/api/auth", authRouter);

  // 以下全部需登入；權限於後端強制（NFR-04）
  app.use("/api", authenticate);
  app.use("/api/users", requireRole("ADMIN"), usersRouter);
  app.use("/api/products", productsRouter);
  app.use("/api/batches", batchesRouter);
  app.use("/api/warehouses", warehousesRouter);
  app.use("/api/locations", locationsRouter);
  app.use("/api/search", searchRouter);
  app.use("/api/stock", stockRouter);
  app.use("/api/movements", movementsRouter);

  app.use(errorHandler);
  return app;
}
