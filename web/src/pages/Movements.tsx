import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthContext";
import { useInvalidateStock } from "../api/hooks";
import { errorMessage, post } from "../api/client";
import type { ReversalPreview } from "../api/types";
import { Field, Message, fmtDate } from "../components/ui";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { get } from "../api/client";
import { useProducts } from "../api/hooks";
import type { Movement, MovementType } from "../api/types";
import { Card, PageTitle, TYPE_LABEL, fmtTime } from "../components/ui";

const TYPES: MovementType[] = ["IN", "OUT", "TRANSFER", "DAMAGE", "ADJUSTMENT", "REVERSAL"];
const TAG: Record<MovementType, string> = { IN: "tag-ok", OUT: "tag-info", TRANSFER: "tag-info", DAMAGE: "tag-bad", ADJUSTMENT: "tag-warn", REVERSAL: "tag-warn" };

/** 主句：「入庫 甘藍菜 +20 籠 → A-01-03」；批次、前後數量、操作者為輔。不可修改。 */
function sentence(m: Movement) {
  const u = m.product.unit;
  switch (m.type) {
    case "IN": return { main: `${m.productNameSnapshot} +${m.quantity} ${u}`, where: `放到 ${m.toLocation?.code ?? m.locationCodeSnapshot}`, delta: `${m.toBeforeQty} → ${m.toAfterQty}` };
    case "OUT": return { main: `${m.productNameSnapshot} −${m.quantity} ${u}`, where: `從 ${m.fromLocation?.code ?? m.locationCodeSnapshot} 取出`, delta: `${m.fromBeforeQty} → ${m.fromAfterQty}` };
    case "TRANSFER": return { main: `${m.productNameSnapshot} ${m.quantity} ${u}`, where: `${m.fromLocation?.code} → ${m.toLocation?.code}`, delta: `來源 ${m.fromBeforeQty}→${m.fromAfterQty}、目的 ${m.toBeforeQty}→${m.toAfterQty}` };
    case "DAMAGE": return { main: `${m.productNameSnapshot} −${m.quantity} ${u}`, where: `${m.fromLocation?.code ?? m.locationCodeSnapshot}`, delta: `${m.fromBeforeQty} → ${m.fromAfterQty}` };
    case "REVERSAL": {
      const parts = [];
      if (m.fromLocation) parts.push(`${m.fromLocation.code} 扣回 ${m.quantity}（${m.fromBeforeQty}→${m.fromAfterQty}）`);
      if (m.toLocation) parts.push(`${m.toLocation.code} 加回 ${m.quantity}（${m.toBeforeQty}→${m.toAfterQty}）`);
      return { main: `復原 #${m.reversalOfId}：${m.productNameSnapshot} ${m.quantity} ${u}`, where: parts.join("、"), delta: `原因：${m.reversalReason ?? ""}` };
    }
    default: return { main: `${m.productNameSnapshot} ${m.toLocationId ? "+" : "−"}${m.quantity} ${u}`, where: m.locationCodeSnapshot, delta: m.toLocationId ? `${m.toBeforeQty} → ${m.toAfterQty}` : `${m.fromBeforeQty} → ${m.fromAfterQty}` };
  }
}

export default function Movements() {
  const { user } = useAuth();
  const invalidate = useInvalidateStock();
  const [params] = useSearchParams();
  const [reversing, setReversing] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
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
      <PageTitle sub="入庫、出庫、搬移、報損、盤點調整、復原；每筆都留下前後數量、操作者與時間，不能刪改">紀錄</PageTitle>
      {msg && <Message kind={msg.kind}>{msg.text}</Message>}
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
                {m.reversedById && <span className="tag-warn">已復原（紀錄 #{m.reversedById}）</span>}
                {user?.role === "ADMIN" && m.type !== "REVERSAL" && !m.reversedById && (
                  <button type="button" className="btn-sm" onClick={() => setReversing(reversing === m.id ? null : m.id)}>{reversing === m.id ? "收起" : "復原這筆操作"}</button>
                )}
                {reversing === m.id && (
                  <ReversalPanel
                    movementId={m.id}
                    onDone={async (text) => { setReversing(null); setMsg({ kind: "ok", text }); await invalidate(); }}
                    onCancel={() => setReversing(null)}
                  />
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}


/** FR-020 復原確認面板：顯示原始異動、預計庫存變化、原因必填；不能復原時說明原因。 */
function ReversalPanel({ movementId, onDone, onCancel }: { movementId: number; onDone: (text: string) => void; onCancel: () => void }) {
  const preview = useQuery({ queryKey: ["reversalPreview", movementId], queryFn: () => get<ReversalPreview>(`/movements/${movementId}/reversal-preview`) });
  const [reason, setReason] = useState("");
  const m = useMutation({
    mutationFn: () => post<{ reversalId: number }>(`/movements/${movementId}/reverse`, { reason: reason.trim() }),
    onSuccess: (r) => onDone(`已復原紀錄 #${movementId}，新增反向紀錄 #${r.reversalId}；原始紀錄保留。`),
  });
  if (!preview.data) return <div className="w-full muted">{preview.error ? errorMessage(preview.error) : "載入中…"}</div>;
  const p = preview.data;
  const mv = p.movement;
  return (
    <div className="w-full rounded-[10px] border-l-4 border-warn bg-warn-soft/40 p-4 space-y-3">
      <p className="text-[20px] font-bold">復原這筆操作</p>
      <div className="grid gap-2 sm:grid-cols-2 text-[18px]">
        <div><span className="muted">原始異動：</span>{TYPE_LABEL[mv.type]} #{mv.id}・{fmtDate(mv.createdAt.slice(0, 10))}</div>
        <div><span className="muted">商品／批次：</span>{mv.productName}・批次 {mv.batchNo}</div>
        <div><span className="muted">原始數量：</span>{mv.quantity} {mv.unit}{mv.fromCode && ` 從 ${mv.fromCode}`}{mv.toCode && ` 到 ${mv.toCode}`}</div>
        <div><span className="muted">原始備註：</span>{mv.reason ?? "—"}</div>
      </div>
      <div>
        <p className="font-bold">預計復原的庫存變化</p>
        {p.changes.map((c) => (
          <p key={c.locationCode} className="text-[18px]">{c.locationCode}：{c.before} → <b>{c.after}</b> {mv.unit}（{c.delta > 0 ? "加回" : "扣回"} {Math.abs(c.delta)}）</p>
        ))}
      </div>
      {p.blocked ? (
        <Message kind="error">無法復原：{p.blocked}</Message>
      ) : (
        <Field label="復原原因（必填）"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例：出錯單、數量填錯" /></Field>
      )}
      {m.error && <Message kind="error">{errorMessage(m.error)}</Message>}
      <div className="flex flex-wrap gap-3">
        <button type="button" className="btn" onClick={onCancel}>取消</button>
        <button type="button" className="btn-primary" disabled={!!p.blocked || !reason.trim() || m.isPending} onClick={() => m.mutate()}>{m.isPending ? "復原中…" : "確認復原"}</button>
      </div>
    </div>
  );
}
