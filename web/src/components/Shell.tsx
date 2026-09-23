import { useState, type ComponentType } from "react";
import { NavLink, Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ChevronIcon, ClipboardIcon, DamageIcon, HistoryIcon, HomeIcon, InboundIcon, LeafIcon, LogoutIcon, MapIcon, MenuIcon, OutboundIcon, SearchIcon, SettingsIcon, TransferIcon } from "./icons";

interface Item { to: string; label: string; icon: ComponentType<{ size?: number }>; adminOnly?: boolean }

const MAIN: Item[] = [
  { to: "/", label: "首頁", icon: HomeIcon },
  { to: "/inventory", label: "查庫存", icon: SearchIcon },
  { to: "/floorplan", label: "平面圖", icon: MapIcon },
  { to: "/inbound", label: "入庫", icon: InboundIcon },
  { to: "/outbound", label: "出庫", icon: OutboundIcon },
];
const MORE: Item[] = [
  { to: "/transfer", label: "搬移", icon: TransferIcon },
  { to: "/damage", label: "報損", icon: DamageIcon },
  { to: "/stocktake", label: "盤點", icon: ClipboardIcon },
  { to: "/movements", label: "紀錄", icon: HistoryIcon },
];
const ADMIN: Item[] = [
  { to: "/products", label: "商品", icon: LeafIcon },
  { to: "/settings", label: "系統設定", icon: SettingsIcon, adminOnly: true },
];

/** 固定左側選單（電腦）／頂部橫向選單（手機）。圖示一律搭配文字。 */
export default function Shell() {
  const { user, loading, logout } = useAuth();
  const loc = useLocation();
  const [moreOpen, setMoreOpen] = useState([...MORE, ...ADMIN].some((m) => loc.pathname.startsWith(m.to)));
  if (loading) return <div className="p-6 text-ink-2">載入中…</div>;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;

  const link = (i: Item) => (
    <NavLink
      key={i.to}
      to={i.to}
      end={i.to === "/"}
      className={({ isActive }) => `flex min-h-[52px] items-center gap-3 rounded-lg px-4 text-[18px] font-medium whitespace-nowrap ${isActive ? "bg-brand text-white" : "text-ink hover:bg-brand-soft"}`}
    >
      <i.icon size={22} />
      {i.label}
    </NavLink>
  );

  return (
    <div className="min-h-screen bg-bg text-ink lg:grid lg:grid-cols-[240px_1fr]">
      <aside className="border-b border-line bg-white lg:sticky lg:top-0 lg:h-screen lg:border-b-0 lg:border-r">
        <div className="px-5 py-5">
          <span className="text-[20px] font-bold">竹南冷凍倉儲</span>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:overflow-visible" aria-label="主選單">
          {MAIN.map(link)}
          <button type="button" onClick={() => setMoreOpen(!moreOpen)} aria-expanded={moreOpen} className="flex min-h-[52px] items-center gap-3 rounded-lg px-4 text-left text-[18px] font-medium whitespace-nowrap text-ink hover:bg-brand-soft">
            <MenuIcon size={22} />其他作業 <ChevronIcon size={18} open={moreOpen} className="ml-auto text-ink-2" />
          </button>
          {moreOpen && (
            <div className="flex gap-1 lg:flex-col lg:pl-3">
              {MORE.map(link)}
              <p className="hidden px-4 pt-3 text-[15px] text-ink-2 lg:block">管理</p>
              {ADMIN.filter((i) => !i.adminOnly || user.role === "ADMIN").map(link)}
            </div>
          )}
        </nav>
        <div className="hidden border-t border-line px-5 py-4 text-[16px] text-ink-2 lg:block">
          <p className="text-ink">{user.displayName}</p>
          <p>{user.role === "ADMIN" ? "管理員" : "工作人員"}</p>
          <button onClick={logout} className="btn-sm mt-3 w-full gap-2"><LogoutIcon size={18} />登出</button>
        </div>
      </aside>
      <div>
        <header className="flex items-center justify-end gap-3 px-4 py-2 text-[16px] text-ink-2 lg:hidden">
          <span>{user.displayName}</span>
          <button onClick={logout} className="btn-sm gap-2"><LogoutIcon size={18} />登出</button>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-5 lg:px-8 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
