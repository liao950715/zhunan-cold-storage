import { z } from "zod";

/** API 與 DB 都用 YYYY-MM-DD 字串（SQLite 文字比較即日期比較）。 */
export const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式須為 YYYY-MM-DD")
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), "日期無效");

/** 「今天」以台灣時間（UTC+8）為準：凌晨 0～8 點不會被當成前一天。 */
export const todayString = () => new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
/** ISO 時間 → 台灣日期 YYYY-MM-DD */
export const taipeiDateOf = (iso: string) => new Date(Date.parse(iso) + 8 * 3_600_000).toISOString().slice(0, 10);

export const daysBetween = (fromYmd: string, toYmd: string) => Math.round((Date.parse(`${toYmd}T00:00:00Z`) - Date.parse(`${fromYmd}T00:00:00Z`)) / 86_400_000);
