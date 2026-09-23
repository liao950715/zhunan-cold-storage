import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { errorMessage, post } from "../api/client";
import { Field, Message } from "../components/ui";

/** 裝置配對：輸入同步碼一次，之後這台裝置就不用再輸入（HttpOnly cookie，90 天）。 */
export default function Pair() {
  const nav = useNavigate();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post("/pair", { code: code.trim() });
      nav("/login", { replace: true });
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
          <p className="text-[18px] text-ink-2">第一次在這台裝置使用，請輸入同步碼</p>
        </div>
        <Field label="同步碼" hint="向管理員取得。輸入一次後，這台裝置 90 天內不用再輸入。">
          <input className="input font-mono" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" autoFocus required />
        </Field>
        {error && <Message kind="error">{error}</Message>}
        <button type="submit" disabled={busy || !code.trim()} className="btn-primary w-full">{busy ? "配對中…" : "配對這台裝置"}</button>
      </form>
    </main>
  );
}
