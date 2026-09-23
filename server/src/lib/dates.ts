import { z } from "zod";

/** API 以 YYYY-MM-DD 交換日期；DB 存 UTC 午夜，避免時區位移。 */
export const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式須為 YYYY-MM-DD")
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), "日期無效");

export const parseDate = (s: string) => new Date(`${s}T00:00:00Z`);
export const formatDate = (d: Date) => d.toISOString().slice(0, 10);
export const todayString = () => formatDate(new Date());
