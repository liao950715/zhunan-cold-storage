import type { ReactNode } from "react";

export function Card({ title, children, actions, className = "" }: { title?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-slate-200 bg-white p-4 ${className}`}>
      {(title || actions) && (
        <div className="mb-3 flex items-center gap-2">
          {title && <h2 className="font-bold text-slate-800">{title}</h2>}
          {actions && <div className="ml-auto flex gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Message({ kind, children }: { kind: "ok" | "error" | "warn"; children: ReactNode }) {
  const cls = kind === "ok" ? "bg-green-50 text-green-800 border-green-200" : kind === "warn" ? "bg-amber-50 text-amber-800 border-amber-200" : "bg-red-50 text-red-700 border-red-200";
  return <div role={kind === "error" ? "alert" : "status"} className={`rounded border px-3 py-2 text-sm ${cls}`}>{children}</div>;
}

export function Field({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-3">
      <h1 className="text-xl font-bold">{children}</h1>
      {sub && <p className="text-sm text-slate-500">{sub}</p>}
    </div>
  );
}

export const TYPE_LABEL: Record<string, string> = { IN: "入庫", OUT: "出庫", TRANSFER: "搬移", DAMAGE: "報損", ADJUSTMENT: "調整" };
export const fmtTime = (iso: string) => new Date(iso).toLocaleString("zh-TW", { hour12: false });
