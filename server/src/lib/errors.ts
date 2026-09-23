export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "ALLOCATION_MISMATCH"
  | "CAPACITY_EXCEEDED"
  | "LOCATION_PRODUCT_CONFLICT"
  | "INSUFFICIENT_STOCK"
  | "LOCATION_NOT_EMPTY"
  | "STOCKTAKE_CONFLICT"
  | "STOCKTAKE_NOT_PENDING"
  | "CAPACITY_BELOW_OCCUPIED"
  | "UNIT_LOCKED"
  | "DUPLICATE_REQUEST"
  | "CONCURRENT_UPDATE"
  | "CONFLICT"
  | "INTERNAL_ERROR";

/** 業務錯誤：在交易內 throw 即整筆回滾，由 errorHandler 統一轉為 JSON。 */
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const notFound = (what: string) => new AppError("NOT_FOUND", 404, `${what}不存在`);
