import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { errorMessage, get, post } from "../api/client";
import { useInvalidateStock, useProducts } from "../api/hooks";
import type { FefoSuggestion, Product, ProductStock } from "../api/types";
import ProductSelect from "../components/ProductSelect";
import { Card, Field, Message, PageTitle } from "../components/ui";
import { useDialog } from "../components/ConfirmDialog";

interface Line { batchId: number; batchNo: string; expiryDate: string; expired: boolean; locationId: number; locationCode: string; available: number; quantity: number }

/**
 * 雙入口出庫（FR-011／012）：
 * 入口 A：選商品 → 輸入數量 → FEFO 建議 → 人工確認批次與儲位。
 * 入口 B：由平面圖／查詢帶 ?productId=&batchId=&locationId=，直接列出該儲位批次。
 */
export default function Outbound() {
  const [params] = useSearchParams();
  const preset = { productId: Number(params.get("productId")) || null, batchId: Number(params.get("batchId")) || null, locationId: Number(params.get("locationId")) || null };
  const products = useProducts();
  const invalidate = useInvalidateStock();
  const dialog = useDialog();
  const [product, setProduct] = useState<Product | null>(null);
  const [quantity, setQuantity] = useState(0);
  const [lines, setLines] = useState<Line[]>([]);
  const [note, setNote] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [idemKey, setIdemKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (preset.productId && !product && products.data) setProduct(products.data.items.find((p) => p.id === preset.productId) ?? null);
  }, [preset.productId, products.data, product]);

  const stock = useQuery({ queryKey: ["productStock", product?.id], queryFn: () => get<ProductStock>(`/products/${product!.id}/stock`), enabled: !!product });

  // 入口 B：預填該儲位的批次
  useEffect(() => {
    if (!stock.data || lines.length > 0 || !preset.locationId) return;
    const rows = stock.data.lines.filter((l) => l.location.id === preset.locationId && (!preset.batchId || l.batch.id === preset.batchId));
    setLines(rows.map((l) => ({ batchId: l.batch.id, batchNo: l.batch.batchNo, expiryDate: l.batch.expiryDate, expired: false, locationId: l.location.id, locationCode: l.location.code, available: l.quantity, quantity: 0 })));
  }, [stock.data, preset.locationId, preset.batchId, lines.length]);

  const suggest = useMutation({
    mutationFn: () => post<FefoSuggestion>("/stock/outbound/suggest", { productId: product!.id, quantity }),
    onSuccess: (s) => setLines(s.suggestions.map((x) => ({ ...x, quantity: x.take }))),
  });

  const total = lines.reduce((s, l) => s + (l.quantity || 0), 0);
  const over = lines.some((l) => l.quantity > l.available);
  const active = lines.filter((l) => l.quantity > 0);

  const m = useMutation({
    mutationFn: () => post<{ total: number }>("/stock/outbound", { productId: product!.id, lines: active.map((l) => ({ batchId: l.batchId, locationId: l.locationId, quantity: l.quantity })), note: note || null }, idemKey),
    onSuccess: async (r) => {
      setResult(`出庫完成：${product!.name} 共 ${r.total} ${product!.unit}（${active.map((l) => `${l.locationCode} ${l.batchNo} −${l.quantity}`).join("、")}）`);
      await invalidate();
      setIdemKey(crypto.randomUUID());
      setLines([]);
      setQuantity(0);
    },
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (active.length === 0 || over) return;
    if (await dialog.confirm("確認出庫", `${product!.name} 共 ${total} ${product!.unit}\n` + active.map((l) => `・${l.locationCode} 批次 ${l.batchNo} −${l.quantity}`).join("\n"))) m.mutate();
  }

  const setQty = (i: number, q: number) => setLines(lines.map((l, j) => (j === i ? { ...l, quantity: q } : l)));

  return (
    <div className="space-y-3">
      <PageTitle sub={preset.locationId ? "從儲位出庫：批次已帶入，請填數量" : "快速出庫：選商品 → 輸入數量 → 查看 FEFO 建議 → 確認"}>出庫</PageTitle>
      {result && <Message kind="ok">{result}</Message>}
      <form onSubmit={submit} className="grid gap-3 lg:grid-cols-2">
        <Card title="1. 商品">
          <ProductSelect value={product?.id ?? null} onChange={(p) => { setProduct(p); setLines([]); }} allowCreate={false} />
          {stock.data && <p className="mt-2 text-sm text-slate-600">目前可用 <b>{stock.data.total} {stock.data.product.unit}</b>，{stock.data.batches.length} 個批次</p>}
        </Card>
        <Card title="2. 數量與 FEFO 建議">
          <div className="flex items-end gap-2">
            <Field label={`出庫數量（${product?.unit ?? "單位"}）`}><input type="number" min={1} className="input" value={quantity || ""} onChange={(e) => setQuantity(Number(e.target.value))} /></Field>
            <button type="button" className="btn-primary" disabled={!product || quantity <= 0 || suggest.isPending} onClick={() => suggest.mutate()}>取得 FEFO 建議</button>
          </div>
          {suggest.data && suggest.data.shortage > 0 && <Message kind="warn">可用 {suggest.data.available}，不足 {suggest.data.shortage} {product?.unit}；請調整數量或只出可用量。</Message>}
          {suggest.error && <Message kind="error">{errorMessage(suggest.error)}</Message>}
          <p className="mt-2 text-xs text-slate-500">FEFO＝先到期先出。建議可修改，最終由您確認每個批次與儲位的數量。</p>
        </Card>
        <Card title="3. 確認批次與儲位" className="lg:col-span-2">
          {lines.length === 0 ? (
            <p className="text-sm text-slate-500">尚無明細。按「取得 FEFO 建議」或從平面圖／查詢進入。</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500"><tr><th className="py-1">儲位</th><th>批次</th><th>到期日</th><th className="text-right">可用</th><th className="text-right w-32">出庫數量</th></tr></thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={`${l.batchId}-${l.locationId}`} className={`border-t border-slate-100 ${l.quantity > 0 ? "bg-sky-50" : ""}`}>
                    <td className="py-1 font-medium">{l.locationCode}</td>
                    <td className="font-mono text-xs">{l.batchNo}</td>
                    <td className={l.expired ? "text-red-600" : ""}>{l.expiryDate}{l.expired && "（已過期）"}</td>
                    <td className="text-right">{l.available}</td>
                    <td className="text-right"><input type="number" min={0} max={l.available} className={`input mt-0 text-right ${l.quantity > l.available ? "border-red-500" : ""}`} value={l.quantity || ""} onChange={(e) => setQty(i, Number(e.target.value))} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Field label="備註"><input className="input mt-0 w-64" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            <p className={`text-sm ${over ? "text-red-600" : ""}`}>合計出庫 <b>{total}</b> {product?.unit}{over && "　— 有明細超過可用量"}</p>
            {m.error && <Message kind="error">{errorMessage(m.error)}</Message>}
            <button type="submit" className="btn-primary ml-auto" disabled={active.length === 0 || over || m.isPending}>{m.isPending ? "送出中…" : "確認出庫"}</button>
          </div>
        </Card>
      </form>
    </div>
  );
}
