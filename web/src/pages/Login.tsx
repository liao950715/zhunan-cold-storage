import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { errorMessage } from "../api/client";
import { Field, Message } from "../components/ui";

export default function Login() {
  const { user, login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username, password);
      nav((loc.state as { from?: string } | null)?.from ?? "/", { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4">
      <form onSubmit={onSubmit} className="panel w-full max-w-md space-y-5">
        <div>
          <h1 className="text-[30px] font-bold">竹南冷凍倉儲</h1>
          <p className="text-[18px] text-ink-2">庫存管理系統</p>
        </div>
        <Field label="帳號"><input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required /></Field>
        <Field label="密碼"><input type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></Field>
        {error && <Message kind="error">{error}</Message>}
        <button type="submit" disabled={busy} className="btn-primary w-full">{busy ? "登入中…" : "登入"}</button>
      </form>
    </main>
  );
}
