import { useEffect, useState, type ComponentType } from "react";
import { NavLink, Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ChevronIcon, ClipboardIcon, DamageIcon, HistoryIcon, HomeIcon, InboundIcon, LeafIcon, LogoutIcon, MapIcon, MenuIcon, OutboundIcon, SearchIcon, SettingsIcon, TransferIcon } from "./icons";

interface Item { to: string; label: string; icon: ComponentType<{ size?: number; className?: string }>; adminOnly?: boolean }

const MAIN: Item[] = [
  { to: "/", label: "首頁", icon: HomeIcon },
  { to: "/inventory", label: "查庫存", icon: SearchIcon },
  { to: "/inbound", label: "入庫", icon: InboundIcon },
  { to: "/outbound", label: "出庫", icon: OutboundIcon },
];
const MORE: Item[] = [
  { to: "/floorplan", label: "平面圖", icon: MapIcon },
  { to: "/transfer", label: "搬移", icon: TransferIcon },
  { to: "/damage", label: "報損", icon: DamageIcon },
  { to: "/stocktake", label: "盤點", icon: ClipboardIcon },
  { to: "/movements", label: "異動紀錄", icon: HistoryIcon },
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

/**
 * 電腦：固定左側選單（首頁／查庫存／入庫／出庫 ＋ 其他作業 ＋ 管理）。
 * 手機／平板：主選單 4 格一列（不橫向捲動），「其他作業」展開成格子。
 */
export default function Shell() {
  const { user, loading, logout } = useAuth();
  const loc = useLocation();
  const inMore = [...MORE, ...ADMIN].some((m) => loc.pathname.startsWith(m.to));
  const [moreOpen, setMoreOpen] = useState(inMore);
  const [large, setLarge] = useLargeText();
  useEffect(() => { if (inMore) setMoreOpen(true); }, [inMore]);
  if (loading) return <div className="p-6 text-ink-2">載入中…</div>;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;

  const link = (i: Item, mobile = false) => (
    <NavLink
      key={i.to}
      to={i.to}
      end={i.to === "/"}
      className={({ isActive }) =>
        mobile
          ? `flex min-h-[56px] flex-col items-center justify-center gap-0.5 rounded-[10px] px-1 text-[16px] font-medium ${isActive ? "bg-brand-soft text-brand-deep" : "text-ink hover:bg-bg-2"}`
          : `flex min-h-[52px] items-center gap-3 rounded-[10px] border-l-4 px-4 text-[18px] font-medium whitespace-nowrap ${isActive ? "border-brand bg-brand-soft text-ink" : "border-transparent text-ink hover:bg-bg-2"}`
      }
    >
      {({ isActive }) => (<><i.icon size={mobile ? 24 : 22} className={isActive ? "text-brand" : "text-ink-2"} />{i.label}</>)}
    </NavLink>
  );
  const admins = ADMIN.filter((i) => !i.adminOnly || user.role === "ADMIN");

  return (
    <div className="min-h-screen bg-bg text-ink lg:grid lg:grid-cols-[240px_1fr]">
      {/* 電腦版側欄 */}
      <aside className="hidden border-r border-line bg-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col">
        <div className="px-5 py-5"><span className="text-[20px] font-bold">竹南冷凍倉儲</span></div>
        <nav className="flex flex-col gap-1 px-3" aria-label="主選單">
          {MAIN.map((i) => link(i))}
          <button type="button" onClick={() => setMoreOpen(!moreOpen)} aria-expanded={moreOpen} className="flex min-h-[52px] items-center gap-3 rounded-[10px] border-l-4 border-transparent px-4 text-left text-[18px] font-medium text-ink hover:bg-bg-2">
            <MenuIcon size={22} className="text-ink-2" />其他作業 <ChevronIcon size={18} open={moreOpen} className="ml-auto text-ink-2" />
          </button>
          {moreOpen && (
            <div className="flex flex-col gap-1 pl-3">
              {MORE.map((i) => link(i))}
              <p className="px-4 pt-3 text-[16px] text-ink-2">管理</p>
              {admins.map((i) => link(i))}
            </div>
          )}
        </nav>
        <div className="mt-auto border-t border-line px-5 py-4 text-[16px] text-ink-2">
          <p className="text-ink">{user.displayName}</p>
          <p>{user.role === "ADMIN" ? "管理員" : "工作人員"}</p>
          <label className="mt-3 flex items-center gap-2 text-ink"><input type="checkbox" checked={large} onChange={(e) => setLarge(e.target.checked)} className="h-5 w-5" /> 文字放大</label>
          <button onClick={logout} className="btn-sm mt-3 w-full gap-2"><LogoutIcon size={18} />登出</button>
        </div>
      </aside>

      <div>
        {/* 手機／平板頂部 */}
        <header className="border-b border-line bg-white lg:hidden">
          <div className="flex items-center gap-2 px-3 py-2 text-[16px] text-ink-2">
            <span className="whitespace-nowrap text-[18px] font-bold text-ink">竹南冷凍倉儲</span>
            <span className="ml-auto min-w-0 truncate">{user.displayName}</span>
            <label className="flex shrink-0 items-center gap-1 whitespace-nowrap"><input type="checkbox" checked={large} onChange={(e) => setLarge(e.target.checked)} /> 放大</label>
            <button onClick={logout} className="btn-sm shrink-0 gap-1 whitespace-nowrap"><LogoutIcon size={18} />登出</button>
          </div>
          <nav className="grid grid-cols-5 gap-1 px-2 pb-2" aria-label="主選單">
            {MAIN.map((i) => link(i, true))}
            <button type="button" onClick={() => setMoreOpen(!moreOpen)} aria-expanded={moreOpen} className={`flex min-h-[56px] flex-col items-center justify-center gap-0.5 rounded-[10px] px-1 text-[16px] font-medium ${moreOpen ? "bg-bg-2" : ""} text-ink`}>
              <MenuIcon size={24} className="text-ink-2" />其他
            </button>
          </nav>
          {moreOpen && (
            <nav className="grid grid-cols-3 gap-1 border-t border-line px-2 py-2 sm:grid-cols-4" aria-label="其他作業">
              {[...MORE, ...admins].map((i) => link(i, true))}
            </nav>
          )}
        </header>
        <main className={`mx-auto px-4 py-5 lg:px-8 lg:py-8 ${loc.pathname.startsWith("/floorplan") ? "max-w-[1400px]" : "max-w-5xl"}`}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
