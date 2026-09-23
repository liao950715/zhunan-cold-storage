import { NavLink, Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

const NAV: Array<{ to: string; label: string; adminOnly?: boolean }> = [
  { to: "/floorplan", label: "冷凍庫平面圖" },
  // Stage 4 加入：Dashboard、商品、庫存查詢、入庫、出庫、報損、盤點、異動紀錄、系統設定
];

export default function Shell() {
  const { user, loading, logout } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="p-6 text-slate-500">載入中…</div>;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800">
      <header className="bg-white border-b border-slate-200">
        <div className="mx-auto max-w-7xl px-4 h-14 flex items-center gap-4">
          <span className="font-bold">竹南冷凍倉儲</span>
          <nav className="flex gap-1 overflow-x-auto">
            {NAV.filter((n) => !n.adminOnly || user.role === "ADMIN").map((n) => (
              <NavLink key={n.to} to={n.to} className={({ isActive }) => `px-3 py-1.5 rounded text-sm whitespace-nowrap ${isActive ? "bg-sky-100 text-sky-800" : "hover:bg-slate-100"}`}>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-slate-600">
              {user.displayName}
              <span className="ml-1 text-xs text-slate-400">{user.role === "ADMIN" ? "管理員" : "工作人員"}</span>
            </span>
            <button onClick={logout} className="text-slate-500 hover:text-slate-800">登出</button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-4">
        <Outlet />
      </main>
    </div>
  );
}
