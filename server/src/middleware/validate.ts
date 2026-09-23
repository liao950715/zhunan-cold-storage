import type { Request } from "express";
import type { ZodTypeAny, z } from "zod";
import { AppError } from "../lib/errors.js";

/** 解析 body／query；失敗時丟 ZodError 由 errorHandler 轉 400。 */
export const parseBody = <T extends ZodTypeAny>(schema: T, req: Request): z.infer<T> => schema.parse(req.body);
export const parseQuery = <T extends ZodTypeAny>(schema: T, req: Request): z.infer<T> => schema.parse(req.query);

export function idParam(req: Request, name = "id"): number {
  const n = Number(req.params[name]);
  if (!Number.isInteger(n) || n <= 0) throw new AppError("VALIDATION_ERROR", 400, `參數 ${name} 必須是正整數`);
  return n;
}
