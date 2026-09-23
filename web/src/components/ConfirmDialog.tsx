import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

interface Pending {
  kind: "confirm" | "prompt";
  title: string;
  message: string;
  defaultValue?: string;
  resolve: (v: boolean | string | null) => void;
}

interface Api {
  confirm: (title: string, message?: string) => Promise<boolean>;
  prompt: (title: string, defaultValue?: string) => Promise<string | null>;
}

const Ctx = createContext<Api | null>(null);

/** 頁面內確認／輸入視窗（取代原生 confirm／prompt）：顯示操作摘要，由使用者確認後才送出。 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const confirm = useCallback((title: string, message = "") => new Promise<boolean>((resolve) => setPending({ kind: "confirm", title, message, resolve: (v) => resolve(v === true) })), []);
  const prompt = useCallback((title: string, defaultValue = "") => {
    setValue(defaultValue);
    return new Promise<string | null>((resolve) => setPending({ kind: "prompt", title, message: "", defaultValue, resolve: (v) => resolve(typeof v === "string" ? v : null) }));
  }, []);

  function close(v: boolean | string | null) {
    pending?.resolve(v);
    setPending(null);
  }

  return (
    <Ctx.Provider value={{ confirm, prompt }}>
      {children}
      {pending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl space-y-3">
            <h2 id="dlg-title" className="font-bold text-slate-800">{pending.title}</h2>
            {pending.message && <pre className="whitespace-pre-wrap font-sans text-sm text-slate-700">{pending.message}</pre>}
            {pending.kind === "prompt" && (
              <input
                ref={inputRef}
                autoFocus
                className="input"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") close(value);
                  if (e.key === "Escape") close(null);
                }}
              />
            )}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn" onClick={() => close(pending.kind === "confirm" ? false : null)}>取消</button>
              <button type="button" className="btn-primary" autoFocus={pending.kind === "confirm"} data-testid="dialog-confirm" onClick={() => close(pending.kind === "confirm" ? true : value)}>確定</button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

export function useDialog() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useDialog 必須在 ConfirmProvider 內使用");
  return v;
}
