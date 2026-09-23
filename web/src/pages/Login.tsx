import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { errorMessage } from "../api/client";

export default function Login() {
  const { user, login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/floorplan" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username, password);
      const to = (loc.state as { from?: string } | null)?.from ?? "/floorplan";
      nav(to, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-100 px-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm bg-white rounded-xl shadow p-6 space-y-4">
        <div>
          <h1 className="text-xl font-bold text-slate-800">竹南冷凍倉儲</h1>
          <p className="text-sm text-slate-500">庫存管理系統登入</p>
        </div>
        <label className="block text-sm">
          <span className="text-slate-700">帳號</span>
          <input className="mt-1 w-full rounded border border-slate-300 px-3 py-2" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
        </label>
        <label className="block text-sm">
          <span className="text-slate-700">密碼</span>
          <input type="password" className="mt-1 w-full rounded border border-slate-300 px-3 py-2" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
        <button type="submit" disabled={busy} className="w-full rounded bg-sky-600 py-2 text-white font-medium hover:bg-sky-700 disabled:opacity-50">
          {busy ? "登入中…" : "登入"}
        </button>
      </form>
    </main>
  );
}
