import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { errorMessage } from "../api/client";
import { Field, Message } from "../components/ui";

export default function Login() {
  const { user, login, expired } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPw, setShowPw] = useState(false);

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
        {expired && <Message kind="warn">登入已逾時（超過 12 小時）或已在別處登出，請重新登入。您剛才在畫面上填的內容需要重新輸入。</Message>}
        <Field label="帳號"><input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required /></Field>
        {/* 密碼欄：切換按鈕放在 label 外面，label 只指向輸入框 */}
        <div>
          <label htmlFor="login-password" className="label block">密碼</label>
          <div className="relative">
            <input id="login-password" type={showPw ? "text" : "password"} className="input pr-24" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
            <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-[8px] px-3 py-1 text-[16px] font-medium text-brand-deep hover:bg-brand-soft" onClick={() => setShowPw(!showPw)} aria-pressed={showPw} aria-label={showPw ? "隱藏密碼" : "顯示密碼"}>{showPw ? "隱藏" : "顯示"}</button>
          </div>
        </div>
        {error && <Message kind="error">{error}</Message>}
        <button type="submit" disabled={busy} className="btn-primary w-full">{busy ? "登入中…" : "登入"}</button>
      </form>
    </main>
  );
}
