import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { get } from "../api/client";
import type { Dashboard as DashboardData } from "../api/types";
import { Card, PageTitle } from "../components/ui";

export default function Dashboard() {
  const q = useQuery({ queryKey: ["dashboard"], queryFn: () => get<DashboardData>("/dashboard") });
  if (!q.data) return <p className="text-slate-500">載入中…</p>;
  const d = q.data;
  return (
    <div className="space-y-4">
      <PageTitle sub="隨時掌握：有什麼、多少、在哪裡、哪批先處理">Dashboard</PageTitle>

      <div className="flex flex-wrap gap-2">
        <Link to="/inbound" className="btn-primary">快速入庫</Link>
        <Link to="/outbound" className="btn-primary">快速出庫</Link>
        <Link to="/inventory" className="btn">庫存查詢</Link>
        <Link to="/floorplan" className="btn">平面圖</Link>
        <Link to="/damage" className="btn">報損</Link>
        <Link to="/stocktake" className="btn">盤點{d.stats.pendingStocktakes > 0 && <span className="ml-1 rounded-full bg-amber-500 px-1.5 text-xs text-white">{d.stats.pendingStocktakes}</span>}</Link>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="有庫存商品" value={`${d.stats.productsInStock} / ${d.stats.activeProducts}`} sub="種" />
        <Stat label="在庫批次" value={d.stats.batchesInStock} sub="批" />
        <Stat label="使用中儲位" value={`${d.stats.occupiedLocations} / ${d.stats.totalLocations}`} sub="個" />
        <Stat label="各單位總量" value={d.totalsByUnit.map((t) => `${t.quantity} ${t.unit}`).join("・") || "0"} sub="不同單位不合計" small />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card title={`效期提醒（${d.expiryAlerts.length}）`}>
          {d.expiryAlerts.length === 0 ? (
            <p className="text-sm text-slate-500">沒有即將到期的批次。</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500"><tr><th>商品</th><th>批次</th><th>到期日</th><th className="text-right">數量</th><th>位置</th></tr></thead>
              <tbody>
                {d.expiryAlerts.map((a) => (
                  <tr key={a.batchId} className="border-t border-slate-100">
                    <td className="py-1">{a.product.name}</td>
                    <td className="font-mono text-xs">{a.batchNo}</td>
                    <td className={a.expired ? "text-red-600 font-medium" : a.daysLeft <= 3 ? "text-amber-700" : ""}>
                      {a.expiryDate}{a.expired ? `（已過期 ${-a.daysLeft} 天）` : `（剩 ${a.daysLeft} 天）`}
                    </td>
                    <td className="text-right">{a.quantity} {a.product.unit}</td>
                    <td><Link className="text-sky-700 hover:underline" to={`/floorplan?warehouse=${a.locations[0]?.[0]}&highlight=${a.locations.join(",")}`}>{a.locations.join("、")}</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title={`低庫存提醒（${d.lowStock.length}）`}>
          {d.lowStock.length === 0 ? (
            <p className="text-sm text-slate-500">所有商品皆高於警戒值。</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500"><tr><th>商品</th><th className="text-right">可用</th><th className="text-right">警戒值</th></tr></thead>
              <tbody>
                {d.lowStock.map((l) => (
                  <tr key={l.productId} className="border-t border-slate-100">
                    <td className="py-1"><Link className="text-sky-700 hover:underline" to={`/inventory?q=${encodeURIComponent(l.name)}`}>{l.name}</Link></td>
                    <td className={`text-right ${l.available === 0 ? "text-red-600 font-medium" : "text-amber-700"}`}>{l.available} {l.unit}</td>
                    <td className="text-right text-slate-500">{l.threshold} {l.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, small }: { label: string; value: string | number; sub?: string; small?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`${small ? "text-base" : "text-2xl"} font-bold text-slate-800`}>{value}</p>
      {sub && <p className="text-xs text-slate-400">{sub}</p>}
    </div>
  );
}
