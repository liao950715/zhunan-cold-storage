import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { get } from "../api/client";
import type { SearchResult } from "../api/types";
import { Card, PageTitle } from "../components/ui";

/** FR-019：依商品名稱／批次編號／儲位編號搜尋，顯示全部匹配位置，點選定位到平面圖並高亮。 */
export default function Inventory() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const [input, setInput] = useState(q);
  const result = useQuery({ queryKey: ["search", q], queryFn: () => get<SearchResult>(`/search?q=${encodeURIComponent(q)}`), enabled: q.length > 0 });

  const lines = result.data?.lines ?? [];
  const byWarehouse = new Map<string, string[]>();
  for (const l of lines) byWarehouse.set(l.location.warehouseCode, [...(byWarehouse.get(l.location.warehouseCode) ?? []), l.location.code]);
  const total = lines.reduce((s, l) => s + l.quantity, 0);
  const units = new Set(lines.map((l) => l.product.unit));

  return (
    <div className="space-y-3">
      <PageTitle sub="輸入商品名稱、批次編號或儲位編號">庫存查詢</PageTitle>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setParams(input ? { q: input } : {});
        }}
      >
        <input className="input mt-0 flex-1" placeholder="例：甘藍菜、B20260923-001、A-01-02" value={input} onChange={(e) => setInput(e.target.value)} autoFocus />
        <button className="btn-primary" type="submit">搜尋</button>
      </form>

      {q && result.data && (
        <>
          {result.data.products.length > 0 && lines.length === 0 && (
            <p className="text-sm text-slate-600">找到商品 {result.data.products.map((p) => p.name).join("、")}，但目前沒有庫存。</p>
          )}
          <Card
            title={`找到 ${lines.length} 筆庫存位置${units.size === 1 ? `，合計 ${total} ${[...units][0]}` : ""}`}
            actions={[...byWarehouse.entries()].map(([code, locs]) => (
              <Link key={code} className="btn" to={`/floorplan?warehouse=${code}&highlight=${[...new Set(locs)].join(",")}`}>
                在冷凍庫 {code} 平面圖定位（{new Set(locs).size} 儲位）
              </Link>
            ))}
          >
            {lines.length === 0 ? (
              <p className="text-sm text-slate-500">沒有符合的庫存。</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-slate-500"><tr><th className="py-1">商品</th><th>批次</th><th>到期日</th><th>冷凍庫</th><th>儲位</th><th className="text-right">數量</th><th></th></tr></thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.inventoryId} className="border-t border-slate-100">
                      <td className="py-1.5">{l.product.name}</td>
                      <td className="font-mono text-xs">{l.batch.batchNo}</td>
                      <td>{l.batch.expiryDate}</td>
                      <td>{l.location.warehouseName}</td>
                      <td className="font-medium">{l.location.code}</td>
                      <td className="text-right">{l.quantity} {l.product.unit}</td>
                      <td className="text-right whitespace-nowrap">
                        <Link className="text-sky-700 hover:underline" to={`/floorplan?warehouse=${l.location.warehouseCode}&highlight=${l.location.code}`}>定位</Link>
                        <Link className="ml-3 text-sky-700 hover:underline" to={`/outbound?productId=${l.product.id}&batchId=${l.batch.id}&locationId=${l.location.id}`}>出庫</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
