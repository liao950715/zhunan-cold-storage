import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { errorMessage, get, post } from "../api/client";
import { useInvalidateStock } from "../api/hooks";
import type { LocationDetail, Movement } from "../api/types";
import LocationSelect from "../components/LocationSelect";
import { Card, Field, Message, PageTitle, Step, StepBanner, fmtDate, fmtTime } from "../components/ui";
import { locationLabel } from "../lib/words";

const REASONS = ["凍傷", "壓損", "腐爛", "包裝破損", "其他"];

/** FR-014 報損：哪個儲位 → 哪一批、多少、原因 → 確認後立即扣庫存。 */
export default function Damage() {
  const [params] = useSearchParams();
  const invalidate = useInvalidateStock();
  const [locId, setLocId] = useState<number | null>(Number(params.get("locationId")) || null);
  const [batchId, setBatchId] = useState<number | null>(null);
  const [quantity, setQuantity] = useState(0);
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [idemKey, setIdemKey] = useState(() => crypto.randomUUID());

  const loc = useQuery({ queryKey: ["location", locId], queryFn: () => get<LocationDetail>(`/locations/${locId}`), enabled: !!locId });
  const line = loc.data?.lines.find((l) => l.batch.id === batchId) ?? (loc.data?.lines.length === 1 ? loc.data.lines[0] : null);
  if (line && batchId !== line.batch.id) setBatchId(line.batch.id);
  const history = useQuery({ queryKey: ["movements", "DAMAGE"], queryFn: () => get<{ items: Movement[] }>("/movements?type=DAMAGE&limit=10") });
  const ok = !!line && quantity > 0 && quantity <= line.quantity && reason.trim().length > 0;
  const stepText = (() => {
    if (!locId) return "請先選儲位：哪個儲位的貨壞了？";
    if (loc.data && loc.data.lines.length === 0) return "這個儲位沒有貨，請選別的儲位";
    if (!line) return "請選是哪一批";
    if (quantity <= 0) return `請填報損數量（單位：${line.product.unit}）`;
    if (quantity > line.quantity) return `最多只能報損 ${line.quantity} ${line.product.unit}，請改小`;
    if (!reason.trim()) return "請選原因（或選「其他」後說明）";
    return "請按「下一步：核對並報損」";
  })();

  const m = useMutation({
    mutationFn: () => post<{ batchNo: string; locationCode: string; after: number }>("/stock/damage", { batchId: line!.batch.id, locationId: locId, quantity, reason: reason.trim() }, idemKey),
    onSuccess: async (r) => {
      setResult(`${line!.product.name} ${quantity} ${line!.product.unit} 已報損（${r.locationCode}，原因：${reason}）。該儲位剩 ${r.after} ${line!.product.unit}。`);
      await invalidate();
      setIdemKey(crypto.randomUUID());
      setConfirming(false); setQuantity(0); setReason(""); setBatchId(null);
    },
    onError: () => setConfirming(false),
  });

  if (result) {
    return (
      <div className="space-y-5">
        <PageTitle>報損完成</PageTitle>
        <div className="panel space-y-2 border-l-8 border-ok"><p className="text-[26px] font-bold text-ok">✓ 報損完成</p><p className="text-[20px]">{result}</p></div>
        <div className="flex flex-wrap gap-3"><button className="btn-primary" onClick={() => setResult(null)}>再報損一筆</button><Link className="btn" to="/movements?type=DAMAGE">看報損紀錄</Link><Link className="btn" to="/">回首頁</Link></div>
      </div>
    );
  }
  if (confirming && line && loc.data) {
    return (
      <div className="space-y-5">
        <PageTitle>確認報損</PageTitle>
        <StepBanner>請核對，按「確認報損」會立即扣除庫存，無法取消</StepBanner>
        <div className="panel space-y-3">
          <p className="text-[26px] font-bold">{line.product.name}，報損 {quantity} {line.product.unit}</p>
          <p className="text-[22px]">在 <b>{locationLabel(loc.data.location.code)}</b></p>
          <p className="text-[22px]">原因：<b>{reason}</b></p>
          <p className="muted">批次 {line.batch.batchNo}・到期 {fmtDate(line.batch.expiryDate)}</p>
        </div>
        {m.error && <Message kind="error">{errorMessage(m.error)}</Message>}
        <div className="flex flex-wrap gap-3"><button className="btn" onClick={() => setConfirming(false)}>返回修改</button><button className="btn-primary" onClick={() => m.mutate()} disabled={m.isPending}>{m.isPending ? "處理中…" : "確認報損"}</button></div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageTitle sub="登記損壞的貨；確認後立即從庫存扣除並留下紀錄">報損</PageTitle>
      <StepBanner>{stepText}</StepBanner>
      {m.error && <Message kind="error">{errorMessage(m.error)}</Message>}
      <Step n={1} title="哪個儲位的貨？" done={!!loc.data && loc.data.lines.length > 0}>
        <LocationSelect value={locId} onChange={(l) => { setLocId(l?.id ?? null); setBatchId(null); setQuantity(0); }} />
        {loc.data && loc.data.lines.length === 0 && <p className="mt-2 text-warn">這個儲位沒有貨。</p>}
      </Step>
      <Step n={2} title="哪一批、多少？" done={!!line && quantity > 0 && quantity <= line.quantity}>
        {!loc.data || loc.data.lines.length === 0 ? <p className="muted">請先選儲位。</p> : (
          <div className="space-y-3">
            {loc.data.lines.length > 1 && loc.data.lines.map((l) => (
              <label key={l.inventoryId} className={`flex min-h-[52px] items-center gap-3 rounded-[10px] border px-4 text-[18px] ${batchId === l.batch.id ? "border-brand bg-brand-soft" : "border-line"}`}>
                <input type="radio" name="batch" className="h-5 w-5" checked={batchId === l.batch.id} onChange={() => setBatchId(l.batch.id)} />
                <span className="font-bold">{l.product.name} {l.quantity} {l.product.unit}</span>
                <span className="muted ml-auto">到期 {fmtDate(l.batch.expiryDate)}・批次 {l.batch.batchNo}</span>
              </label>
            ))}
            {line && (
              <div className="flex items-center gap-3">
                <input type="number" min={1} max={line.quantity} inputMode="numeric" className="input mt-0 max-w-[200px] text-[24px] font-bold" value={quantity || ""} onChange={(e) => setQuantity(Number(e.target.value))} aria-label="報損數量" />
                <span className="text-[24px] font-bold">{line.product.unit}</span>
                <span className="muted">這裡有 {line.quantity} {line.product.unit}</span>
              </div>
            )}
            {line && quantity > line.quantity && <p className="text-bad">最多只能報損 {line.quantity} {line.product.unit}。</p>}
          </div>
        )}
      </Step>
      <Step n={3} title="原因" done={reason.trim().length > 0}>
        <div className="flex flex-wrap gap-2">
          {REASONS.map((r) => <button key={r} type="button" className={reason === r ? "btn-primary" : "btn"} onClick={() => setReason(r)}>{r}</button>)}
        </div>
        {(reason === "其他" || !REASONS.includes(reason)) && (
          <Field label="請說明原因"><input className="input" value={reason === "其他" ? "" : reason} onChange={(e) => setReason(e.target.value)} placeholder="例：冷凍庫停電解凍" /></Field>
        )}
      </Step>
      <Step n={4} title="確認報損">
        {ok ? <p className="text-[20px]"><b>{line!.product.name}</b> {quantity} {line!.product.unit}，{loc.data!.location.code}，原因：{reason}</p> : <p className="text-warn">請先完成上面的步驟。</p>}
        <button type="button" className="btn-primary mt-4 w-full sm:w-auto" disabled={!ok} onClick={() => setConfirming(true)}>下一步：核對並報損</button>
      </Step>
      <Card title="最近報損">
        {history.data?.items.length === 0 && <p className="muted">尚無報損紀錄</p>}
        <div className="divide-y divide-line">
          {history.data?.items.map((mv) => (
            <div key={mv.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="flex-1"><p className="text-[20px] font-bold">{mv.productNameSnapshot} −{mv.quantity} {mv.product.unit}<span className="ml-2 font-normal text-ink-2">{mv.locationCodeSnapshot}</span></p><p className="muted">{mv.reason}・{mv.operator.displayName}・{fmtTime(mv.createdAt)}</p></div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
