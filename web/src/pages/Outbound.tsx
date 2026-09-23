import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { errorMessage, get, post } from "../api/client";
import { useInvalidateStock, useProducts } from "../api/hooks";
import type { FefoSuggestion, Product, ProductStock } from "../api/types";
import ProductSelect from "../components/ProductSelect";
import { Message, PageTitle, Step, fmtDate } from "../components/ui";

interface Line { batchId: number; batchNo: string; expiryDate: string; expired: boolean; locationId: number; locationCode: string; available: number; quantity: number }

/**
 * 出庫（FR-011／012）：要出什麼 → 要出多少 → 到哪裡拿（系統建議先拿快到期的，可調整）→ 確認出庫。
 * 從平面圖／查詢帶 ?productId=&batchId=&locationId= 進來時，直接列出該儲位。
 */
export default function Outbound() {
  const [params] = useSearchParams();
  const preset = { productId: Number(params.get("productId")) || null, batchId: Number(params.get("batchId")) || null, locationId: Number(params.get("locationId")) || null };
  const products = useProducts();
  const invalidate = useInvalidateStock();
  const [product, setProduct] = useState<Product | null>(null);
  const [quantity, setQuantity] = useState(0);
  const [lines, setLines] = useState<Line[]>([]);
  const [adjusting, setAdjusting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<Line[] | null>(null);
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
    setAdjusting(true);
  }, [stock.data, preset.locationId, preset.batchId, lines.length]);

  const suggest = useMutation({
    mutationFn: (qty: number) => post<FefoSuggestion>("/stock/outbound/suggest", { productId: product!.id, quantity: qty }),
    onSuccess: (s) => setLines(s.suggestions.map((x) => ({ ...x, quantity: x.take }))),
  });

  // 填好數量就自動給建議（不需再按按鈕）
  useEffect(() => {
    if (!product || quantity <= 0 || preset.locationId) return;
    const t = setTimeout(() => suggest.mutate(quantity), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.id, quantity]);

  const total = lines.reduce((s, l) => s + (l.quantity || 0), 0);
  const over = lines.some((l) => l.quantity > l.available);
  const active = lines.filter((l) => l.quantity > 0);
  const shortage = suggest.data?.shortage ?? 0;

  const m = useMutation({
    mutationFn: () => post<{ total: number }>("/stock/outbound", { productId: product!.id, lines: active.map((l) => ({ batchId: l.batchId, locationId: l.locationId, quantity: l.quantity })) }, idemKey),
    onSuccess: async () => {
      setResult(active);
      await invalidate();
      setIdemKey(crypto.randomUUID());
      setConfirming(false);
      setLines([]);
      setQuantity(0);
      suggest.reset();
    },
    onError: () => setConfirming(false),
  });

  const setQty = (i: number, q: number) => setLines(lines.map((l, j) => (j === i ? { ...l, quantity: q } : l)));
  const unit = product?.unit ?? "";

  if (result && product) {
    return (
      <div className="space-y-5">
        <PageTitle>出庫完成</PageTitle>
        <div className="panel space-y-3 border-l-8 border-ok">
          <p className="text-[26px] font-bold text-ok">✓ 出庫完成</p>
          <p className="text-[22px] font-bold">{product.name}，共 {result.reduce((s, l) => s + l.quantity, 0)} {unit}</p>
          {result.map((l) => <p key={`${l.batchId}-${l.locationId}`} className="text-[20px]">從 <b>{l.locationCode}</b> 取 {l.quantity} {unit}<span className="muted">（批次 {l.batchNo}）</span></p>)}
        </div>
        <div className="flex flex-wrap gap-3">
          <button className="btn-primary" onClick={() => setResult(null)}>再出庫一筆</button>
          <Link className="btn" to={`/inventory?q=${encodeURIComponent(product.name)}`}>查看剩餘庫存</Link>
          <Link className="btn" to="/">回首頁</Link>
        </div>
      </div>
    );
  }

  if (confirming && product) {
    return (
      <div className="space-y-5">
        <PageTitle sub="請核對取貨位置與數量">確認出庫</PageTitle>
        <div className="panel space-y-3">
          <p className="text-[26px] font-bold">{product.name}，出庫 {total} {unit}</p>
          {active.map((l) => (
            <p key={`${l.batchId}-${l.locationId}`} className="text-[22px]">從 <b>{l.locationCode}</b> 取 {l.quantity} {unit}<span className="ml-2 muted">到期 {fmtDate(l.expiryDate)}・批次 {l.batchNo}</span></p>
          ))}
        </div>
        {m.error && <Message kind="error">{errorMessage(m.error)}</Message>}
        <div className="flex flex-wrap gap-3">
          <button className="btn" onClick={() => setConfirming(false)}>返回修改</button>
          <button className="btn-primary" onClick={() => m.mutate()} disabled={m.isPending}>{m.isPending ? "出庫中…" : "確認出庫"}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageTitle sub={preset.locationId ? "從這個儲位取貨：請填數量" : "要出什麼 → 要出多少 → 到哪裡拿 → 確認"}>出庫</PageTitle>
      {m.error && <Message kind="error">{errorMessage(m.error)}</Message>}

      <Step n={1} title="要出什麼？" done={!!product}>
        <ProductSelect value={product?.id ?? null} onChange={(p) => { setProduct(p); setLines([]); suggest.reset(); }} allowCreate={false} />
        {stock.data && <p className="mt-3 text-[20px]">目前有 <b>{stock.data.total} {stock.data.product.unit}</b>，分在 {stock.data.lines.length} 個儲位</p>}
      </Step>

      {!preset.locationId && (
        <Step n={2} title="要出多少？" done={quantity > 0}>
          <div className="flex items-center gap-3">
            <input type="number" min={1} inputMode="numeric" className="input mt-0 max-w-[200px] text-[24px] font-bold" value={quantity || ""} onChange={(e) => setQuantity(Number(e.target.value))} disabled={!product} aria-label="出庫數量" />
            <span className="text-[24px] font-bold">{unit}</span>
          </div>
          {shortage > 0 && <Message kind="warn">庫存只有 {suggest.data!.available} {unit}，不夠 {shortage} {unit}。可以先出 {suggest.data!.available} {unit}，或改數量。</Message>}
        </Step>
      )}

      <Step n={preset.locationId ? 2 : 3} title="到哪裡拿？" done={active.length > 0 && !over}>
        {lines.length === 0 ? (
          <p className="muted">{product ? "填好數量後，這裡會列出建議的取貨位置（先拿快到期的）。" : "請先選商品。"}</p>
        ) : (
          <div className="space-y-3">
            {!preset.locationId && <p className="muted">系統建議優先出即將到期的貨；不合適可以按「調整」。</p>}
            <div className="divide-y divide-line">
              {lines.map((l, i) => (
                <div key={`${l.batchId}-${l.locationId}`} className={`flex flex-wrap items-center gap-3 py-3 ${l.quantity > 0 ? "" : "opacity-60"}`}>
                  <div className="flex-1">
                    <p className="text-[22px] font-bold">從 {l.locationCode} 取 {adjusting ? "" : `${l.quantity} ${unit}`}</p>
                    <p className="muted">
                      這裡有 {l.available} {unit}・到期 {fmtDate(l.expiryDate)}
                      {l.expired && <span className="tag-bad ml-2">已過期</span>}
                      <span className="ml-2">批次 {l.batchNo}</span>
                    </p>
                  </div>
                  {adjusting && (
                    <div className="flex items-center gap-2">
                      <input type="number" min={0} max={l.available} inputMode="numeric" className={`input mt-0 w-28 text-[22px] font-bold ${l.quantity > l.available ? "border-bad" : ""}`} value={l.quantity || ""} onChange={(e) => setQty(i, Number(e.target.value))} aria-label={`${l.locationCode} 出庫數量`} />
                      <span className="text-[20px]">{unit}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {!preset.locationId && <button type="button" className="btn-sm" onClick={() => setAdjusting(!adjusting)}>{adjusting ? "完成調整" : "調整取貨位置或數量"}</button>}
              <span className={`text-[18px] ${over ? "font-bold text-bad" : ""}`}>合計 {total} {unit}{over && "　— 有一筆超過該儲位的數量"}</span>
            </div>
          </div>
        )}
      </Step>

      <Step n={preset.locationId ? 3 : 4} title="確認出庫">
        {active.length === 0 ? <p className="text-warn">請先完成上面的步驟。</p> : over ? <p className="text-bad">請把超過的數量改小。</p> : <p className="text-[20px]"><b>{product!.name}</b> 共 {total} {unit}，從 {active.map((l) => l.locationCode).join("、")} 取</p>}
        <button type="button" className="btn-primary mt-4 w-full sm:w-auto" disabled={active.length === 0 || over} onClick={() => setConfirming(true)}>下一步：核對並出庫</button>
      </Step>
    </div>
  );
}
