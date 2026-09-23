import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { errorMessage, get, post } from "../api/client";
import { useInvalidateStock } from "../api/hooks";
import type { LocationDetail } from "../api/types";
import LocationSelect from "../components/LocationSelect";
import { Card, Field, Message, PageTitle } from "../components/ui";
import { useDialog } from "../components/ConfirmDialog";

/** FR-013 部分數量搬移：來源儲位 → 選批次 → 數量 → 目的儲位。總量不變。 */
export default function Transfer() {
  const [params] = useSearchParams();
  const invalidate = useInvalidateStock();
  const dialog = useDialog();
  const [fromId, setFromId] = useState<number | null>(Number(params.get("locationId")) || null);
  const [batchId, setBatchId] = useState<number | null>(Number(params.get("batchId")) || null);
  const [toId, setToId] = useState<number | null>(null);
  const [quantity, setQuantity] = useState(0);
  const [note, setNote] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [idemKey, setIdemKey] = useState(() => crypto.randomUUID());

  const from = useQuery({ queryKey: ["location", fromId], queryFn: () => get<LocationDetail>(`/locations/${fromId}`), enabled: !!fromId });
  const line = from.data?.lines.find((l) => l.batch.id === batchId) ?? null;
  const productId = from.data?.currentProduct?.id ?? null;

  const m = useMutation({
    mutationFn: () => post<{ batchNo: string; from: { code: string; after: number }; to: { code: string; after: number } }>("/stock/transfer", { batchId, fromLocationId: fromId, toLocationId: toId, quantity, note: note || null }, idemKey),
    onSuccess: async (r) => {
      setResult(`搬移完成：批次 ${r.batchNo} ${quantity} → ${r.from.code} 剩 ${r.from.after}、${r.to.code} 現有 ${r.to.after}（商品總量不變）`);
      await invalidate();
      setIdemKey(crypto.randomUUID());
      setQuantity(0);
      setBatchId(null);
    },
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!line || !toId || quantity <= 0 || quantity > line.quantity) return;
    if (await dialog.confirm("確認搬移", `${line.product.name} ${quantity} ${line.product.unit}\n批次 ${line.batch.batchNo}：${from.data!.location.code} → 目的儲位\n商品總量不變。`)) m.mutate();
  }

  return (
    <div className="space-y-3">
      <PageTitle sub="指定同一批次的部分數量，從來源儲位移往目的儲位；這是實物作業紀錄，不是布局編輯">搬移</PageTitle>
      {result && <Message kind="ok">{result}</Message>}
      <form onSubmit={submit} className="grid gap-3 lg:grid-cols-2">
        <Card title="1. 來源儲位與批次">
          <LocationSelect value={fromId} onChange={(l) => { setFromId(l?.id ?? null); setBatchId(null); }} />
          {from.data && from.data.lines.length === 0 && <p className="mt-2 text-sm text-slate-500">此儲位沒有庫存。</p>}
          {from.data && from.data.lines.length > 0 && (
            <div className="mt-2 space-y-1">
              {from.data.lines.map((l) => (
                <label key={l.inventoryId} className={`flex items-center gap-2 rounded border px-2 py-1 text-sm ${batchId === l.batch.id ? "border-sky-500 bg-sky-50" : "border-slate-200"}`}>
                  <input type="radio" name="batch" checked={batchId === l.batch.id} onChange={() => setBatchId(l.batch.id)} />
                  <span className="font-mono text-xs">{l.batch.batchNo}</span>
                  <span>{l.product.name}</span>
                  <span className="text-slate-500">到期 {l.batch.expiryDate}</span>
                  <span className="ml-auto">{l.quantity} {l.product.unit}</span>
                </label>
              ))}
            </div>
          )}
        </Card>
        <Card title="2. 數量與目的儲位">
          <Field label={`搬移數量${line ? `（可用 ${line.quantity} ${line.product.unit}）` : ""}`}>
            <input type="number" min={1} max={line?.quantity} className="input" value={quantity || ""} onChange={(e) => setQuantity(Number(e.target.value))} disabled={!line} />
          </Field>
          <div className="mt-2">
            <Field label="目的儲位" hint="存放不同商品的儲位不可選；容量由後端驗證">
              <LocationSelect value={toId} onChange={(l) => setToId(l?.id ?? null)} productId={productId} exclude={fromId ? [fromId] : []} className="mt-1" />
            </Field>
          </div>
          <Field label="備註"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          {m.error && <Message kind="error">{errorMessage(m.error)}</Message>}
          <button type="submit" className="btn-primary mt-3" disabled={!line || !toId || quantity <= 0 || quantity > (line?.quantity ?? 0) || m.isPending}>確認搬移</button>
        </Card>
      </form>
    </div>
  );
}
