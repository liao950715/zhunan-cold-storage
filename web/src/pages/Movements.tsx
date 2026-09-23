import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { get } from "../api/client";
import { useProducts } from "../api/hooks";
import type { Movement, MovementType } from "../api/types";
import { Card, PageTitle, TYPE_LABEL, fmtTime } from "../components/ui";

const TYPES: MovementType[] = ["IN", "OUT", "TRANSFER", "DAMAGE", "ADJUSTMENT"];
const TAG: Record<MovementType, string> = { IN: "tag-ok", OUT: "tag-info", TRANSFER: "tag-info", DAMAGE: "tag-bad", ADJUSTMENT: "tag-warn" };

/** 主句：「入庫 甘藍菜 +20 籠 → A-01-03」；批次、前後數量、操作者為輔。不可修改。 */
function sentence(m: Movement) {
  const u = m.product.unit;
  switch (m.type) {
    case "IN": return { main: `${m.productNameSnapshot} +${m.quantity} ${u}`, where: `放到 ${m.toLocation?.code ?? m.locationCodeSnapshot}`, delta: `${m.toBeforeQty} → ${m.toAfterQty}` };
    case "OUT": return { main: `${m.productNameSnapshot} −${m.quantity} ${u}`, where: `從 ${m.fromLocation?.code ?? m.locationCodeSnapshot} 取出`, delta: `${m.fromBeforeQty} → ${m.fromAfterQty}` };
    case "TRANSFER": return { main: `${m.productNameSnapshot} ${m.quantity} ${u}`, where: `${m.fromLocation?.code} → ${m.toLocation?.code}`, delta: `來源 ${m.fromBeforeQty}→${m.fromAfterQty}、目的 ${m.toBeforeQty}→${m.toAfterQty}` };
    case "DAMAGE": return { main: `${m.productNameSnapshot} −${m.quantity} ${u}`, where: `${m.fromLocation?.code ?? m.locationCodeSnapshot}`, delta: `${m.fromBeforeQty} → ${m.fromAfterQty}` };
    default: return { main: `${m.productNameSnapshot} ${m.toLocationId ? "+" : "−"}${m.quantity} ${u}`, where: m.locationCodeSnapshot, delta: m.toLocationId ? `${m.toBeforeQty} → ${m.toAfterQty}` : `${m.fromBeforeQty} → ${m.fromAfterQty}` };
  }
}

export default function Movements() {
  const [params] = useSearchParams();
  const [type, setType] = useState<MovementType | "">((params.get("type") as MovementType) || "");
  const [productId, setProductId] = useState<number | "">("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const products = useProducts(true);
  const qs = new URLSearchParams({ limit: "200" });
  if (type) qs.set("type", type);
  if (productId) qs.set("productId", String(productId));
  if (dateFrom) qs.set("dateFrom", dateFrom);
  if (dateTo) qs.set("dateTo", dateTo);
  const q = useQuery({ queryKey: ["movements", qs.toString()], queryFn: () => get<{ items: Movement[]; total: number }>(`/movements?${qs}`) });

  return (
    <div className="space-y-4">
      <PageTitle sub="入庫、出庫、搬移、報損、盤點調整；每筆都留下前後數量、操作者與時間，不能刪改">紀錄</PageTitle>
      <div className="flex flex-wrap gap-2">
        <button className={type === "" ? "btn-primary" : "btn"} onClick={() => setType("")}>全部</button>
        {TYPES.map((t) => <button key={t} className={type === t ? "btn-primary" : "btn"} onClick={() => setType(t)}>{TYPE_LABEL[t]}</button>)}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <select className="input mt-0 w-56" value={productId} onChange={(e) => setProductId(Number(e.target.value) || "")} aria-label="商品">
          <option value="">全部商品</option>
          {products.data?.items.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <input type="date" className="input mt-0 w-44" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} aria-label="起日" />
        <span>～</span>
        <input type="date" className="input mt-0 w-44" value={dateTo} onChange={(e) => setDateTo(e.target.value)} aria-label="迄日" />
        <span className="muted">共 {q.data?.total ?? 0} 筆</span>
      </div>
      <Card>
        {q.data?.items.length === 0 && <p className="muted">沒有紀錄</p>}
        <div className="divide-y divide-line">
          {q.data?.items.map((m) => {
            const s = sentence(m);
            return (
              <div key={m.id} className="flex flex-wrap items-center gap-3 py-3">
                <span className={`${TAG[m.type]} w-24 text-center`}>{TYPE_LABEL[m.type]}</span>
                <div className="flex-1 min-w-[200px]">
                  <p className="text-[20px] font-bold">{s.main}<span className="ml-2 font-normal text-ink-2">{s.where}</span></p>
                  <p className="muted">{s.delta}・批次 {m.batch.batchNo}{m.reason && `・${m.reason}`}</p>
                </div>
                <div className="text-right text-[16px] text-ink-2"><p>{m.operator.displayName}</p><p>{fmtTime(m.createdAt)}</p></div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
