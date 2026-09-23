import { useState } from "react";
import { NavLink, Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

interface Item { to: string; label: string; icon: string; hint?: string; adminOnly?: boolean }

const MAIN: Item[] = [
  { to: "/", label: "首頁", icon: "🏠" },
  { to: "/inventory", label: "查庫存", icon: "🔍", hint: "找商品、看數量與位置" },
  { to: "/inbound", label: "入庫", icon: "📥", hint: "貨物放進冷凍庫" },
  { to: "/outbound", label: "出庫", icon: "📤", hint: "貨物從冷凍庫取出" },
];
const MORE: Item[] = [
  { to: "/transfer", label: "搬移", icon: "↔️" },
  { to: "/damage", label: "報損", icon: "⚠️" },
  { to: "/stocktake", label: "盤點", icon: "📋" },
  { to: "/movements", label: "紀錄", icon: "🕘" },
];
const ADMIN: Item[] = [
  { to: "/products", label: "商品", icon: "🥬" },
  { to: "/settings", label: "系統設定", icon: "⚙️", adminOnly: true },
];

/** 固定左側選單（電腦）／頂部橫向選單（手機）。 */
export default function Shell() {
  const { user, loading, logout } = useAuth();
  const loc = useLocation();
  const [moreOpen, setMoreOpen] = useState(MORE.some((m) => loc.pathname.startsWith(m.to)) || ADMIN.some((m) => loc.pathname.startsWith(m.to)));
  if (loading) return <div className="p-6 text-ink-2">載入中…</div>;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;

  const link = (i: Item) => (
    <NavLink
      key={i.to}
      to={i.to}
      end={i.to === "/"}
      className={({ isActive }) => `flex min-h-[52px] items-center gap-3 rounded-lg px-4 text-[18px] font-medium ${isActive ? "bg-brand text-white" : "text-ink hover:bg-brand-soft"}`}
    >
      <span aria-hidden className="text-[22px]">{i.icon}</span>
      {i.label}
    </NavLink>
  );

  return (
    <div className="min-h-screen bg-bg text-ink lg:grid lg:grid-cols-[240px_1fr]">
      <aside className="border-b border-line bg-white lg:sticky lg:top-0 lg:h-screen lg:border-b-0 lg:border-r">
        <div className="flex items-center gap-2 px-4 py-4">
          <span className="text-[20px] font-bold">竹南冷凍倉儲</span>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:overflow-visible">
          {MAIN.map(link)}
          <button type="button" onClick={() => setMoreOpen(!moreOpen)} className="flex min-h-[52px] items-center gap-3 rounded-lg px-4 text-left text-[18px] font-medium text-ink hover:bg-brand-soft">
            <span aria-hidden className="text-[22px]">☰</span>其他作業 <span className="ml-auto text-ink-2">{moreOpen ? "▾" : "▸"}</span>
          </button>
          {moreOpen && (
            <div className="flex gap-1 lg:flex-col lg:pl-3">
              {MORE.map(link)}
              <p className="hidden px-4 pt-2 text-[16px] text-ink-2 lg:block">管理</p>
              {ADMIN.filter((i) => !i.adminOnly || user.role === "ADMIN").map(link)}
            </div>
          )}
        </nav>
        <div className="hidden border-t border-line px-4 py-4 text-[16px] text-ink-2 lg:block">
          <p className="text-ink">{user.displayName}</p>
          <p>{user.role === "ADMIN" ? "管理員" : "工作人員"}</p>
          <button onClick={logout} className="btn-sm mt-3 w-full">登出</button>
        </div>
      </aside>
      <div>
        <header className="flex items-center justify-end gap-3 px-4 py-2 text-[16px] text-ink-2 lg:hidden">
          <span>{user.displayName}</span>
          <button onClick={logout} className="btn-sm">登出</button>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-5 lg:px-8 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
