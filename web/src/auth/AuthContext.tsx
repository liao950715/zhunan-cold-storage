import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { get, isNetworkError, post } from "../api/client";
import type { AuthUser } from "../api/types";

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  /** 啟動時連不到伺服器（不是未登入） */
  offline: boolean;
  /** 登入逾時被系統登出（登入頁用來說明原因） */
  expired: boolean;
  retry: () => void;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [expired, setExpired] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setLoading(true);
    setOffline(false);
    get<{ user: AuthUser }>("/auth/me")
      .then((r) => { setUser(r.user); setExpired(false); })
      .catch((e) => { if (isNetworkError(e)) setOffline(true); else setUser(null); })
      .finally(() => setLoading(false));
  }, [attempt]);

  // 任何 API 回「請先登入」→ 登入逾時：切回登入頁並說明（不會清掉使用者正在填的畫面以外的東西）
  useEffect(() => {
    const onExpired = () => { setUser((u) => { if (u) setExpired(true); return null; }); };
    window.addEventListener("zn:auth-expired", onExpired);
    return () => window.removeEventListener("zn:auth-expired", onExpired);
  }, []);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const login = useCallback(async (username: string, password: string) => {
    const r = await post<{ user: AuthUser }>("/auth/login", { username, password });
    setUser(r.user);
    setExpired(false);
  }, []);

  const logout = useCallback(async () => {
    await post("/auth/logout", {});
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, loading, offline, expired, retry, login, logout }), [user, loading, offline, expired, retry, login, logout]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth 必須在 AuthProvider 內使用");
  return v;
}
