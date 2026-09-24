export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly error: ApiError,
  ) {
    super(error.message);
  }
}

/** 統一 fetch：帶 cookie、JSON、錯誤轉 ApiRequestError（含後端 code／message）。 */
export async function api<T>(path: string, init: RequestInit & { idempotencyKey?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (init.body) headers["Content-Type"] = "application/json";
  if (init.idempotencyKey) headers["Idempotency-Key"] = init.idempotencyKey;
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { credentials: "include", ...init, headers });
  } catch {
    // 連不到伺服器（沒網路、訊號不好、伺服器沒回應）：明確告訴使用者是網路問題，不當成一般錯誤
    throw new ApiRequestError(0, { code: "NETWORK", message: "連不到伺服器：請確認網路或訊號後，按「重試」。剛才還沒送出的資料都還在畫面上。" });
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error: ApiError = body.error ?? { code: "INTERNAL_ERROR", message: `請求失敗（${res.status}）` };
    // 尚未配對的裝置：導到同步碼頁（登入頁除外的所有 API 都會回 NOT_PAIRED）
    if (error.code === "NOT_PAIRED" && !location.pathname.startsWith("/pair")) location.assign("/pair");
    // 登入逾時（12 小時）或被登出：通知 AuthProvider 切回登入頁並說明原因（登入 API 本身的 401 不算）
    if (res.status === 401 && error.code === "UNAUTHENTICATED" && !path.startsWith("/auth/login")) window.dispatchEvent(new CustomEvent("zn:auth-expired"));
    throw new ApiRequestError(res.status, error);
  }
  return body as T;
}

export const get = <T>(path: string) => api<T>(path);
export const post = <T>(path: string, body: unknown, idempotencyKey?: string) => api<T>(path, { method: "POST", body: JSON.stringify(body), idempotencyKey });
export const put = <T>(path: string, body: unknown) => api<T>(path, { method: "PUT", body: JSON.stringify(body) });
export const patch = <T>(path: string, body: unknown) => api<T>(path, { method: "PATCH", body: JSON.stringify(body) });
export const del = <T>(path: string) => api<T>(path, { method: "DELETE" });

export const errorMessage = (e: unknown) => (e instanceof ApiRequestError ? e.error.message : e instanceof Error ? e.message : "發生未知錯誤");
export const isNetworkError = (e: unknown) => e instanceof ApiRequestError && e.error.code === "NETWORK";
