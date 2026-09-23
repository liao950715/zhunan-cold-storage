import express from "express";
import cookieParser from "cookie-parser";

/** 建立 Express app（不 listen），供 index.ts 與 Supertest 共用。 */
export function createApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", service: "zhunan-cold-storage", stage: 0 });
  });

  return app;
}
