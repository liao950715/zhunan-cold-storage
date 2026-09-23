import { useEffect, useState, type ComponentType } from "react";
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

const LARGE_KEY = "zn-large-text";
function useLargeText() {
  const [large, setLarge] = useState(() => { try { return localStorage.getItem(LARGE_KEY) === "1"; } catch { return false; } });
  useEffect(() => {
    document.documentElement.dataset.large = large ? "1" : "0";
    try { localStorage.setItem(LARGE_KEY, large ? "1" : "0"); } catch { /* ignore */ }
  }, [large]);
  return [large, setLarge] as const;
}

/** 固定左側選單（電腦）／頂部橫向選單（手機）。選中＝淺藍底＋左側色條＋深色字；圖示一律搭配文字。 */
export default function Shell() {
  const { user, loading, logout } = useAuth();
  const loc = useLocation();
  const [moreOpen, setMoreOpen] = useState([...MORE, ...ADMIN].some((m) => loc.pathname.startsWith(m.to)));
  const [large, setLarge] = useLargeText();
  if (loading) return <div className="p-6 text-ink-2">載入中…</div>;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;

  const link = (i: Item) => (
    <NavLink
      key={i.to}
      to={i.to}
      end={i.to === "/"}
      className={({ isActive }) => `flex min-h-[52px] items-center gap-3 rounded-[10px] border-l-4 px-4 text-[18px] font-medium whitespace-nowrap ${isActive ? "border-brand bg-brand-soft text-ink" : "border-transparent text-ink hover:bg-bg-2"}`}
    >
      {({ isActive }) => (<><i.icon size={22} {...({ className: isActive ? "text-brand-deep" : "text-ink-2" } as object)} />{i.label}</>)}
    </NavLink>
  );

  return (
    <div className="min-h-screen bg-bg text-ink lg:grid lg:grid-cols-[240px_1fr]">
      <aside className="border-b border-line bg-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:border-b-0 lg:border-r">
        <div className="px-5 py-5">
          <span className="text-[20px] font-bold">竹南冷凍倉儲</span>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:overflow-visible" aria-label="主選單">
          {MAIN.map(link)}
          <button type="button" onClick={() => setMoreOpen(!moreOpen)} aria-expanded={moreOpen} className="flex min-h-[52px] items-center gap-3 rounded-[10px] border-l-4 border-transparent px-4 text-left text-[18px] font-medium whitespace-nowrap text-ink hover:bg-bg-2">
            <MenuIcon size={22} className="text-ink-2" />其他作業 <ChevronIcon size={18} open={moreOpen} className="ml-auto text-ink-2" />
          </button>
          {moreOpen && (
            <div className="flex gap-1 lg:flex-col lg:pl-3">
              {MORE.map(link)}
              <p className="hidden px-4 pt-3 text-[15px] text-ink-2 lg:block">管理</p>
              {ADMIN.filter((i) => !i.adminOnly || user.role === "ADMIN").map(link)}
            </div>
          )}
        </nav>
        <div className="hidden border-t border-line px-5 py-4 text-[16px] text-ink-2 lg:mt-auto lg:block">
          <p className="text-ink">{user.displayName}</p>
          <p>{user.role === "ADMIN" ? "管理員" : "工作人員"}</p>
          <label className="mt-3 flex items-center gap-2 text-ink"><input type="checkbox" checked={large} onChange={(e) => setLarge(e.target.checked)} className="h-5 w-5" /> 文字放大</label>
          <button onClick={logout} className="btn-sm mt-3 w-full gap-2"><LogoutIcon size={18} />登出</button>
        </div>
      </aside>
      <div>
        <header className="flex items-center justify-end gap-3 px-4 py-2 text-[16px] text-ink-2 lg:hidden">
          <label className="flex items-center gap-1"><input type="checkbox" checked={large} onChange={(e) => setLarge(e.target.checked)} /> 放大</label>
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
