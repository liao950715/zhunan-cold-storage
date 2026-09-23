import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { errorMessage, get, post } from "../api/client";
import { useInvalidateStock } from "../api/hooks";
import type { LocationDetail } from "../api/types";
import LocationSelect from "../components/LocationSelect";
import LocationPicker from "../components/LocationPicker";
import { Message, PageTitle, Step, fmtDate } from "../components/ui";
import { locationLabel } from "../lib/words";

/** FR-013 搬移：從哪裡搬 → 搬哪一批、多少 → 搬到哪裡 → 確認。總量不變。 */
export default function Transfer() {
  const [params] = useSearchParams();
  const invalidate = useInvalidateStock();
  const [fromId, setFromId] = useState<number | null>(Number(params.get("locationId")) || null);
  const [batchId, setBatchId] = useState<number | null>(Number(params.get("batchId")) || null);
  const [toId, setToId] = useState<number | null>(null);
  const [quantity, setQuantity] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [idemKey, setIdemKey] = useState(() => crypto.randomUUID());

  const from = useQuery({ queryKey: ["location", fromId], queryFn: () => get<LocationDetail>(`/locations/${fromId}`), enabled: !!fromId });
  const to = useQuery({ queryKey: ["location", toId], queryFn: () => get<LocationDetail>(`/locations/${toId}`), enabled: !!toId });
  const line = from.data?.lines.find((l) => l.batch.id === batchId) ?? (from.data?.lines.length === 1 ? from.data.lines[0] : null);
  if (line && batchId !== line.batch.id) setBatchId(line.batch.id);
  const productId = from.data?.currentProduct?.id ?? null;
  const ok = !!line && !!toId && quantity > 0 && quantity <= line.quantity;

  const m = useMutation({
    mutationFn: () => post<{ batchNo: string; from: { code: string; after: number }; to: { code: string; after: number } }>("/stock/transfer", { batchId: line!.batch.id, fromLocationId: fromId, toLocationId: toId, quantity }, idemKey),
    onSuccess: async (r) => {
      setResult(`${line!.product.name} ${quantity} ${line!.product.unit}，從 ${r.from.code} 搬到 ${r.to.code}。${r.from.code} 剩 ${r.from.after}、${r.to.code} 現有 ${r.to.after}（商品總量不變）。`);
      await invalidate();
      setIdemKey(crypto.randomUUID());
      setConfirming(false); setQuantity(0); setBatchId(null); setToId(null);
    },
    onError: () => setConfirming(false),
  });

  if (result) {
    return (
      <div className="space-y-5">
        <PageTitle>搬移完成</PageTitle>
        <div className="panel space-y-2 border-l-8 border-ok"><p className="text-[26px] font-bold text-ok">✓ 搬移完成</p><p className="text-[20px]">{result}</p></div>
        <div className="flex flex-wrap gap-3"><button className="btn-primary" onClick={() => setResult(null)}>再搬一筆</button><Link className="btn" to="/floorplan">看平面圖</Link><Link className="btn" to="/">回首頁</Link></div>
      </div>
    );
  }
  if (confirming && line && to.data) {
    return (
      <div className="space-y-5">
        <PageTitle sub="請核對">確認搬移</PageTitle>
        <div className="panel space-y-3">
          <p className="text-[26px] font-bold">{line.product.name}，搬 {quantity} {line.product.unit}</p>
          <p className="text-[22px]">從 <b>{locationLabel(from.data!.location.code)}</b></p>
          <p className="text-[22px]">到 <b>{locationLabel(to.data.location.code)}</b></p>
          <p className="muted">批次 {line.batch.batchNo}・到期 {fmtDate(line.batch.expiryDate)}・商品總量不變</p>
        </div>
        {m.error && <Message kind="error">{errorMessage(m.error)}</Message>}
        <div className="flex flex-wrap gap-3"><button className="btn" onClick={() => setConfirming(false)}>返回修改</button><button className="btn-primary" onClick={() => m.mutate()} disabled={m.isPending}>{m.isPending ? "搬移中…" : "確認搬移"}</button></div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageTitle sub="把同一批貨的一部分，從一個儲位搬到另一個儲位">搬移</PageTitle>
      {m.error && <Message kind="error">{errorMessage(m.error)}</Message>}
      <Step n={1} title="從哪裡搬？" done={!!from.data && from.data.lines.length > 0}>
        <LocationSelect value={fromId} onChange={(l) => { setFromId(l?.id ?? null); setBatchId(null); setQuantity(0); }} />
        {from.data && from.data.lines.length === 0 && <p className="mt-2 text-warn">這個儲位沒有貨，請選別的儲位。</p>}
      </Step>
      <Step n={2} title="搬哪一批、多少？" done={!!line && quantity > 0 && quantity <= line.quantity}>
        {!from.data || from.data.lines.length === 0 ? <p className="muted">請先選來源儲位。</p> : (
          <div className="space-y-3">
            {from.data.lines.length > 1 && (
              <div className="space-y-2">
                {from.data.lines.map((l) => (
                  <label key={l.inventoryId} className={`flex min-h-[52px] items-center gap-3 rounded-[10px] border px-4 text-[18px] ${batchId === l.batch.id ? "border-brand bg-brand-soft" : "border-line"}`}>
                    <input type="radio" name="batch" className="h-5 w-5" checked={batchId === l.batch.id} onChange={() => setBatchId(l.batch.id)} />
                    <span className="font-bold">{l.product.name} {l.quantity} {l.product.unit}</span>
                    <span className="muted ml-auto">到期 {fmtDate(l.batch.expiryDate)}・批次 {l.batch.batchNo}</span>
                  </label>
                ))}
              </div>
            )}
            {line && (
              <div className="flex items-center gap-3">
                <input type="number" min={1} max={line.quantity} inputMode="numeric" className="input mt-0 max-w-[200px] text-[24px] font-bold" value={quantity || ""} onChange={(e) => setQuantity(Number(e.target.value))} aria-label="搬移數量" />
                <span className="text-[24px] font-bold">{line.product.unit}</span>
                <span className="muted">這裡有 {line.quantity} {line.product.unit}</span>
              </div>
            )}
            {line && quantity > line.quantity && <p className="text-bad">最多只能搬 {line.quantity} {line.product.unit}。</p>}
          </div>
        )}
      </Step>
      <Step n={3} title="搬到哪裡？" done={!!toId}>
        <LocationPicker value={toId} onChange={(l) => setToId(l?.id ?? null)} productId={productId} exclude={fromId ? [fromId] : []} alsoHighlight={fromId ? [fromId] : []} label="搬到" />
        <p className="mt-1 muted">放了別的商品或已滿的儲位不能選；容量由系統再次檢查。</p>
      </Step>
      <Step n={4} title="確認搬移">
        {ok ? <p className="text-[20px]"><b>{line!.product.name}</b> {quantity} {line!.product.unit}：{from.data!.location.code} → {to.data?.location.code ?? "…"}</p> : <p className="text-warn">請先完成上面的步驟。</p>}
        <button type="button" className="btn-primary mt-4 w-full sm:w-auto" disabled={!ok || !to.data} onClick={() => setConfirming(true)}>下一步：核對並搬移</button>
      </Step>
    </div>
  );
}
