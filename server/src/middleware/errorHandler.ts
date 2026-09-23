import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { AppError } from "../lib/errors.js";

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "輸入資料有誤：" + err.issues.map((i) => `${i.path.join(".") || "body"} ${i.message}`).join("；"),
        details: err.issues,
      },
    });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    return res.status(409).json({ error: { code: "CONFLICT", message: "資料重複，違反唯一性限制", details: err.meta } });
  }
  console.error(err);
  return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "系統發生錯誤，請稍後再試" } });
}
