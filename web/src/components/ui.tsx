import { useState, type ReactNode } from "react";

export function Card({ title, children, actions, className = "" }: { title?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={`panel ${className}`}>
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          {title && <h2 className="text-[20px] font-bold text-ink">{title}</h2>}
          {actions && <div className="ml-auto flex flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** 狀態訊息：顏色＋文字並用（不只靠顏色）。 */
export function Message({ kind, children }: { kind: "ok" | "error" | "warn"; children: ReactNode }) {
  const cls = kind === "ok" ? "bg-ok-soft text-ok" : kind === "warn" ? "bg-warn-soft text-warn" : "bg-bad-soft text-bad";
  const label = kind === "ok" ? "完成" : kind === "warn" ? "注意" : "無法執行";
  return (
    <div role={kind === "error" ? "alert" : "status"} className={`rounded-lg px-4 py-3 text-[18px] ${cls}`}>
      <b className="mr-2">{label}：</b>{children}
    </div>
  );
}

/** 欄位名稱固定在輸入框上方。 */
export function Field({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block muted">{hint}</span>}
    </label>
  );
}

export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-5">
      <h1 className="text-[30px] font-bold leading-tight text-ink">{children}</h1>
      {sub && <p className="mt-1 text-[18px] text-ink-2">{sub}</p>}
    </div>
  );
}

/** 表單步驟：編號＋標題，讓人照著單子填。 */
export function Step({ n, title, children, done }: { n: number; title: ReactNode; children: ReactNode; done?: boolean }) {
  return (
    <section className="panel">
      <h2 className="mb-3 flex items-center gap-3 text-[20px] font-bold">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[18px] ${done ? "bg-ok text-white" : "bg-brand text-white"}`}>{done ? "✓" : n}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

export function Collapsible({ label, children, defaultOpen = false }: { label: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button type="button" className="text-[18px] font-medium text-brand underline-offset-4 hover:underline" onClick={() => setOpen(!open)}>
        {open ? "▾" : "▸"} {label}
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}

export const TYPE_LABEL: Record<string, string> = { IN: "入庫", OUT: "出庫", TRANSFER: "搬移", DAMAGE: "報損", ADJUSTMENT: "盤點調整" };
export const fmtTime = (iso: string) => new Date(iso).toLocaleString("zh-TW", { hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
export const fmtDate = (d: string) => d.replace(/-/g, "/");
