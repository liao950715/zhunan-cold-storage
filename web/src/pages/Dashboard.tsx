import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { get } from "../api/client";
import type { Dashboard as DashboardData } from "../api/types";
import { Card, Collapsible, PageTitle, fmtDate } from "../components/ui";

/** 首頁：1 找貨 → 2 入庫／出庫 → 3 需要處理 → 4 庫存概況。 */
export default function Dashboard() {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const d = useQuery({ queryKey: ["dashboard"], queryFn: () => get<DashboardData>("/dashboard") }).data;

  function search(e: FormEvent) {
    e.preventDefault();
    if (q.trim()) nav(`/inventory?q=${encodeURIComponent(q.trim())}`);
  }

  const expired = d?.expiryAlerts.filter((a) => a.expired) ?? [];
  const expiring = d?.expiryAlerts.filter((a) => !a.expired) ?? [];
  const todo = (d ? expired.length + expiring.length + d.lowStock.length + d.stats.pendingStocktakes : 0);

  return (
    <div className="space-y-6">
      <PageTitle sub="先找貨，或直接入庫、出庫">首頁</PageTitle>

      <form onSubmit={search} className="flex gap-3">
        <input className="input mt-0 flex-1" placeholder="輸入商品名稱或儲位，例如：甘藍菜、A-01-02" value={q} onChange={(e) => setQ(e.target.value)} aria-label="搜尋商品或儲位" />
        <button className="btn-primary" type="submit">🔍 找貨</button>
      </form>

      <div className="grid gap-4 sm:grid-cols-3">
        <BigLink to="/inventory" icon="🔍" title="查庫存" hint="找商品、看數量與位置" />
        <BigLink to="/inbound" icon="📥" title="入庫" hint="貨物放進冷凍庫" primary />
        <BigLink to="/outbound" icon="📤" title="出庫" hint="貨物從冷凍庫取出" primary />
      </div>

      <Card title={`需要處理（${todo}）`}>
        {!d ? (
          <p className="muted">載入中…</p>
        ) : todo === 0 ? (
          <p className="text-[18px] text-ok">目前沒有需要處理的事情。</p>
        ) : (
          <div className="space-y-4">
            {expired.length > 0 && (
              <TodoGroup tag="tag-bad" label={`已過期 ${expired.length} 批`}>
                {expired.map((a) => <AlertRow key={a.batchId} text={`${a.product.name} ${a.quantity} ${a.product.unit}`} sub={`已過期 ${-a.daysLeft} 天（${fmtDate(a.expiryDate)}）・在 ${a.locations.join("、")}`} to={`/floorplan?warehouse=${a.locations[0]?.[0]}&highlight=${a.locations.join(",")}`} action="去處理" />)}
              </TodoGroup>
            )}
            {expiring.length > 0 && (
              <TodoGroup tag="tag-warn" label={`即將到期 ${expiring.length} 批`}>
                {expiring.map((a) => <AlertRow key={a.batchId} text={`${a.product.name} ${a.quantity} ${a.product.unit}`} sub={`剩 ${a.daysLeft} 天到期（${fmtDate(a.expiryDate)}）・在 ${a.locations.join("、")}`} to={`/outbound?productId=${a.product.id}`} action="優先出貨" />)}
              </TodoGroup>
            )}
            {d.lowStock.length > 0 && (
              <TodoGroup tag="tag-warn" label={`庫存偏低 ${d.lowStock.length} 種`}>
                {d.lowStock.map((l) => <AlertRow key={l.productId} text={`${l.name} 剩 ${l.available} ${l.unit}`} sub={`警戒值 ${l.threshold} ${l.unit}`} to={`/inbound`} action="去入庫" />)}
              </TodoGroup>
            )}
            {d.stats.pendingStocktakes > 0 && (
              <TodoGroup tag="tag-warn" label={`待核准盤點 ${d.stats.pendingStocktakes} 張`}>
                <AlertRow text="有盤點單等待管理員核准" sub="核准後才會調整正式庫存" to="/stocktake" action="查看盤點" />
              </TodoGroup>
            )}
          </div>
        )}
      </Card>

      {d && (
        <Card title="庫存概況">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat label="有貨的商品" value={`${d.stats.productsInStock} 種`} />
            <Stat label="在庫批次" value={`${d.stats.batchesInStock} 批`} />
            <Stat label="使用中儲位" value={`${d.stats.occupiedLocations} / ${d.stats.totalLocations}`} />
            <Stat label="各單位總量" value={d.totalsByUnit.map((t) => `${t.quantity} ${t.unit}`).join("・") || "0"} small />
          </div>
          <p className="mt-2 muted">不同單位（籠、箱、公斤）分開計算，不相加。<Link className="ml-2 text-brand underline" to="/floorplan">看平面圖</Link></p>
        </Card>
      )}
    </div>
  );
}

function BigLink({ to, icon, title, hint, primary }: { to: string; icon: string; title: string; hint: string; primary?: boolean }) {
  return (
    <Link to={to} className={`flex min-h-[110px] flex-col justify-center rounded-xl px-5 py-4 shadow-sm ${primary ? "bg-brand text-white hover:bg-brand-dark" : "bg-white text-ink hover:bg-brand-soft"}`}>
      <span className="text-[26px] font-bold"><span aria-hidden className="mr-2">{icon}</span>{title}</span>
      <span className={`text-[16px] ${primary ? "text-white/90" : "text-ink-2"}`}>{hint}</span>
    </Link>
  );
}

function TodoGroup({ tag, label, children }: { tag: string; label: string; children: React.ReactNode }) {
  const items = Array.isArray(children) ? children : [children];
  const [first, rest] = [items.slice(0, 3), items.slice(3)];
  return (
    <div>
      <span className={tag}>{label}</span>
      <div className="mt-2 divide-y divide-line">{first}</div>
      {rest.length > 0 && <Collapsible label={`查看全部（還有 ${rest.length} 筆）`}><div className="divide-y divide-line">{rest}</div></Collapsible>}
    </div>
  );
}

function AlertRow({ text, sub, to, action }: { text: string; sub: string; to: string; action: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3 py-3">
      <div className="flex-1">
        <p className="text-[20px] font-bold">{text}</p>
        <p className="muted">{sub}</p>
      </div>
      <Link className="btn-sm" to={to}>{action}</Link>
    </div>
  );
}

function Stat({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="rounded-lg bg-bg p-4">
      <p className="muted">{label}</p>
      <p className={`${small ? "text-[18px]" : "text-[26px]"} font-bold`}>{value}</p>
    </div>
  );
}
