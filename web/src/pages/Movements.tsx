import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { get } from "../api/client";
import { useProducts } from "../api/hooks";
import type { Movement, MovementType } from "../api/types";
import { Card, PageTitle, TYPE_LABEL, fmtTime } from "../components/ui";

const TYPES: MovementType[] = ["IN", "OUT", "TRANSFER", "DAMAGE", "ADJUSTMENT"];
const TYPE_CLASS: Record<MovementType, string> = { IN: "bg-green-100 text-green-800", OUT: "bg-sky-100 text-sky-800", TRANSFER: "bg-violet-100 text-violet-800", DAMAGE: "bg-red-100 text-red-800", ADJUSTMENT: "bg-amber-100 text-amber-800" };

/** FR-016 異動紀錄：五類可篩選；顯示前後數量、操作者與時間；不可修改。 */
export default function Movements() {
  const [type, setType] = useState<MovementType | "">("");
  const [productId, setProductId] = useState<number | "">("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const products = useProducts(true);
  const qs = new URLSearchParams();
  if (type) qs.set("type", type);
  if (productId) qs.set("productId", String(productId));
  if (dateFrom) qs.set("dateFrom", dateFrom);
  if (dateTo) qs.set("dateTo", dateTo);
  qs.set("limit", "200");
  const q = useQuery({ queryKey: ["movements", qs.toString()], queryFn: () => get<{ items: Movement[]; total: number }>(`/movements?${qs}`) });

  return (
    <div className="space-y-3">
      <PageTitle sub="入庫、出庫、搬移、報損、調整五類紀錄；每筆保留前後數量、操作者與時間，不可抹除">異動紀錄</PageTitle>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select className="input mt-0 w-32" value={type} onChange={(e) => setType(e.target.value as MovementType | "")}>
          <option value="">全部類型</option>
          {TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
        </select>
        <select className="input mt-0 w-44" value={productId} onChange={(e) => setProductId(Number(e.target.value) || "")}>
          <option value="">全部商品</option>
          {products.data?.items.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <input type="date" className="input mt-0 w-40" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        <span>～</span>
        <input type="date" className="input mt-0 w-40" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        <span className="text-slate-500">共 {q.data?.total ?? 0} 筆</span>
      </div>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead className="text-left text-xs text-slate-500"><tr><th className="py-1">時間</th><th>類型</th><th>商品</th><th>批次</th><th>來源 → 目的</th><th className="text-right">數量</th><th className="text-right">來源 前→後</th><th className="text-right">目的 前→後</th><th>原因／備註</th><th>操作者</th></tr></thead>
            <tbody>
              {q.data?.items.map((m) => (
                <tr key={m.id} className="border-t border-slate-100">
                  <td className="py-1 text-xs">{fmtTime(m.createdAt)}</td>
                  <td><span className={`rounded px-1.5 py-0.5 text-xs ${TYPE_CLASS[m.type]}`}>{TYPE_LABEL[m.type]}</span></td>
                  <td>{m.productNameSnapshot}{m.productNameSnapshot !== m.product.name && <span className="text-xs text-slate-400">（現名 {m.product.name}）</span>}</td>
                  <td className="font-mono text-xs">{m.batch.batchNo}</td>
                  <td>{m.locationCodeSnapshot}</td>
                  <td className="text-right font-medium">{m.type === "IN" || (m.type === "ADJUSTMENT" && m.toLocationId) ? "+" : m.type === "TRANSFER" ? "" : "−"}{m.quantity} {m.product.unit}</td>
                  <td className="text-right text-xs text-slate-600">{m.fromBeforeQty !== null ? `${m.fromBeforeQty} → ${m.fromAfterQty}` : "—"}</td>
                  <td className="text-right text-xs text-slate-600">{m.toBeforeQty !== null ? `${m.toBeforeQty} → ${m.toAfterQty}` : "—"}</td>
                  <td className="max-w-64 truncate text-xs" title={m.reason ?? ""}>{m.reason ?? ""}</td>
                  <td>{m.operator.displayName}</td>
                </tr>
              ))}
              {q.data?.items.length === 0 && <tr><td colSpan={10} className="py-3 text-center text-slate-500">沒有紀錄</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
