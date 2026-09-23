import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { get } from "../api/client";
import type { SearchResult, StockLine } from "../api/types";
import { Card, Collapsible, PageTitle, fmtDate } from "../components/ui";
import SearchBox from "../components/SearchBox";

/** 查庫存（FR-019）：先看「商品、總量、位置、最近到期日」，展開才看各批次；不同單位分開。 */
export default function Inventory() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const result = useQuery({ queryKey: ["search", q], queryFn: () => get<SearchResult>(`/search?q=${encodeURIComponent(q)}`), enabled: q.length > 0 });

  const lines = result.data?.lines ?? [];
  const groups = new Map<number, { name: string; unit: string; total: number; lines: StockLine[] }>();
  for (const l of lines) {
    const g = groups.get(l.product.id) ?? { name: l.product.name, unit: l.product.unit, total: 0, lines: [] };
    g.total += l.quantity;
    g.lines.push(l);
    groups.set(l.product.id, g);
  }

  return (
    <div className="space-y-5">
      <PageTitle sub="輸入商品名稱、儲位或批次編號">查庫存</PageTitle>
      <SearchBox initial={q} autoFocus onSearch={(t) => setParams({ q: t })} />
      {!q && (
        <div className="flex flex-wrap items-center gap-3">
          <Link className="btn" to="/floorplan">看冷凍庫平面圖</Link>
          <span className="muted">在圖上點儲位，就能看到裡面放什麼。</span>
        </div>
      )}

      {q && result.data && groups.size === 0 && (
        <Card>
          <p className="text-[20px]">找不到「{q}」的庫存。</p>
          {result.data.products.length > 0 && <p className="muted">商品 {result.data.products.map((p) => p.name).join("、")} 存在，但目前沒有貨。</p>}
        </Card>
      )}

      {[...groups.entries()].map(([productId, g]) => {
        const locs = [...new Set(g.lines.map((l) => l.location.code))];
        const soonest = g.lines.reduce((s, l) => (l.batch.expiryDate < s ? l.batch.expiryDate : s), g.lines[0].batch.expiryDate);
        const byWarehouse = new Map<string, string[]>();
        for (const l of g.lines) byWarehouse.set(l.location.warehouseCode, [...new Set([...(byWarehouse.get(l.location.warehouseCode) ?? []), l.location.code])]);
        return (
          <Card key={productId}>
            <div className="flex flex-wrap items-start gap-4">
              <div className="flex-1">
                <p className="text-[26px] font-bold">{g.name}　<span className="text-brand">{g.total} {g.unit}</span></p>
                <p className="text-[20px]">位置：<b>{locs.join("、")}</b></p>
                <p className="muted">最近到期日 {fmtDate(soonest)}・{g.lines.length} 筆存放紀錄</p>
              </div>
              <div className="flex flex-col gap-2">
                {[...byWarehouse.entries()].map(([code, codes]) => (
                  <Link key={code} className="btn" to={`/floorplan?warehouse=${code}&highlight=${codes.join(",")}`}>在 {code} 庫平面圖標出位置</Link>
                ))}
                <Link className="btn-primary" to={`/outbound?productId=${productId}`}>出這個商品</Link>
              </div>
            </div>
            <div className="mt-3">
              <Collapsible label="查看各批次與儲位">
                <div className="divide-y divide-line">
                  {g.lines.map((l) => (
                    <div key={l.inventoryId} className="flex flex-wrap items-center gap-3 py-3">
                      <div className="flex-1">
                        <p className="text-[20px] font-bold">{l.location.code}：{l.quantity} {g.unit}</p>
                        <p className="muted">{l.location.warehouseName}・到期 {fmtDate(l.batch.expiryDate)}・批次 {l.batch.batchNo}</p>
                      </div>
                      <Link className="btn-sm" to={`/floorplan?warehouse=${l.location.warehouseCode}&highlight=${l.location.code}`}>標出位置</Link>
                      <Link className="btn-sm" to={`/outbound?productId=${productId}&batchId=${l.batch.id}&locationId=${l.location.id}`}>從這裡出貨</Link>
                    </div>
                  ))}
                </div>
              </Collapsible>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
