import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { errorMessage, get, post } from "../api/client";
import { useInvalidateStock } from "../api/hooks";
import type { LocationDetail, Movement } from "../api/types";
import LocationSelect from "../components/LocationSelect";
import { Card, Field, Message, PageTitle, fmtTime } from "../components/ui";
import { useDialog } from "../components/ConfirmDialog";

/** FR-014 直接報損：選儲位 → 批次 → 數量與原因 → 立即扣可用庫存。 */
export default function Damage() {
  const [params] = useSearchParams();
  const invalidate = useInvalidateStock();
  const dialog = useDialog();
  const [locId, setLocId] = useState<number | null>(Number(params.get("locationId")) || null);
  const [batchId, setBatchId] = useState<number | null>(null);
  const [quantity, setQuantity] = useState(0);
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [idemKey, setIdemKey] = useState(() => crypto.randomUUID());

  const loc = useQuery({ queryKey: ["location", locId], queryFn: () => get<LocationDetail>(`/locations/${locId}`), enabled: !!locId });
  const line = loc.data?.lines.find((l) => l.batch.id === batchId) ?? null;
  const history = useQuery({ queryKey: ["movements", "DAMAGE"], queryFn: () => get<{ items: Movement[] }>("/movements?type=DAMAGE&limit=20") });

  const m = useMutation({
    mutationFn: () => post<{ batchNo: string; locationCode: string; after: number }>("/stock/damage", { batchId, locationId: locId, quantity, reason }, idemKey),
    onSuccess: async (r) => {
      setResult(`已報損 ${quantity} ${line?.product.unit}：${r.locationCode} 批次 ${r.batchNo} 剩 ${r.after}`);
      await invalidate();
      setIdemKey(crypto.randomUUID());
      setQuantity(0);
      setReason("");
      setBatchId(null);
    },
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!line || quantity <= 0 || quantity > line.quantity || !reason.trim()) return;
    if (await dialog.confirm("確認報損", `${line.product.name} ${quantity} ${line.product.unit}（${loc.data!.location.code} 批次 ${line.batch.batchNo}）\n原因：${reason}\n確認後立即扣除庫存。`)) m.mutate();
  }

  return (
    <div className="space-y-3">
      <PageTitle sub="登記損壞商品，確認後立即扣除可用庫存並留下紀錄">報損管理</PageTitle>
      {result && <Message kind="ok">{result}</Message>}
      <form onSubmit={submit} className="grid gap-3 lg:grid-cols-2">
        <Card title="1. 儲位與批次">
          <LocationSelect value={locId} onChange={(l) => { setLocId(l?.id ?? null); setBatchId(null); }} />
          {loc.data?.lines.map((l) => (
            <label key={l.inventoryId} className={`mt-2 flex items-center gap-2 rounded border px-2 py-1 text-sm ${batchId === l.batch.id ? "border-sky-500 bg-sky-50" : "border-slate-200"}`}>
              <input type="radio" name="batch" checked={batchId === l.batch.id} onChange={() => setBatchId(l.batch.id)} />
              <span className="font-mono text-xs">{l.batch.batchNo}</span>
              <span>{l.product.name}</span>
              <span className="ml-auto">{l.quantity} {l.product.unit}</span>
            </label>
          ))}
          {loc.data && loc.data.lines.length === 0 && <p className="mt-2 text-sm text-slate-500">此儲位沒有庫存。</p>}
        </Card>
        <Card title="2. 報損數量與原因">
          <Field label={`數量${line ? `（可用 ${line.quantity} ${line.product.unit}）` : ""}`}><input type="number" min={1} max={line?.quantity} className="input" value={quantity || ""} onChange={(e) => setQuantity(Number(e.target.value))} disabled={!line} required /></Field>
          <Field label="原因 *"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例：凍傷、壓損、腐爛" required /></Field>
          {m.error && <Message kind="error">{errorMessage(m.error)}</Message>}
          <button type="submit" className="btn-primary mt-3" disabled={!line || quantity <= 0 || quantity > (line?.quantity ?? 0) || !reason.trim() || m.isPending}>確認報損</button>
        </Card>
      </form>
      <Card title="最近報損紀錄">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500"><tr><th className="py-1">時間</th><th>商品</th><th>批次</th><th>儲位</th><th className="text-right">數量</th><th>原因</th><th>操作者</th></tr></thead>
          <tbody>
            {history.data?.items.map((mv) => (
              <tr key={mv.id} className="border-t border-slate-100">
                <td className="py-1 text-xs">{fmtTime(mv.createdAt)}</td><td>{mv.productNameSnapshot}</td><td className="font-mono text-xs">{mv.batch.batchNo}</td><td>{mv.locationCodeSnapshot}</td><td className="text-right">{mv.quantity} {mv.product.unit}</td><td>{mv.reason}</td><td>{mv.operator.displayName}</td>
              </tr>
            ))}
            {history.data?.items.length === 0 && <tr><td colSpan={7} className="py-2 text-slate-500">尚無報損紀錄</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
