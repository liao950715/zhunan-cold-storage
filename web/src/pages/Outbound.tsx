import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { errorMessage, get, post } from "../api/client";
import { todayStr, useAllLocations, useInvalidateStock, useLayout, useProducts, useWarehouses } from "../api/hooks";
import FloorplanCanvas from "../features/floorplan/FloorplanCanvas";
import { toDraft } from "../features/floorplan/geometry";
import type { FefoSuggestion, Product, ProductStock } from "../api/types";
import ProductSelect from "../components/ProductSelect";
import { Message, PageTitle, Step, StepBanner, fmtDate, fmtReceived } from "../components/ui";
import { locationWords } from "../lib/words";

interface Line { batchId: number; batchNo: string; receivedDate: string; receivedAt?: string; expiryDate: string; expired: boolean; daysLeft?: number; expiringSoon?: boolean; locationId: number; locationCode: string; available: number; quantity: number }

/**
 * 出庫（FR-011／012）：要出什麼 → 要出多少 → 到哪裡拿（系統建議先進先出：最早進貨的先拿，可調整）→ 確認出庫。
 * 選好商品就預設出 1（2026-10-01）：建議優先出庫（最早進貨、未過期）的那一格直接是已選狀態，數量與位置都還能改。
 * 效期另外警示：已過期不自動安排、快到期標示、較晚進貨卻較早到期的批次會提醒。
 * 從平面圖／查詢帶 ?productId=&batchId=&locationId= 進來時，直接列出該儲位。
 */
export default function Outbound() {
  const [params] = useSearchParams();
  const preset = { productId: Number(params.get("productId")) || null, batchId: Number(params.get("batchId")) || null, locationId: Number(params.get("locationId")) || null };
  const products = useProducts();
  const invalidate = useInvalidateStock();
  const warehouses = useWarehouses();
  const allLocs = useAllLocations();
  const [whId, setWhId] = useState<number | null>(null);
  const [product, setProduct] = useState<Product | null>(null);
  const [quantity, setQuantity] = useState(0);
  const [lines, setLines] = useState<Line[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<Line[] | null>(null);
  const [idemKey, setIdemKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (!preset.productId || product || !products.data) return;
    const p = products.data.items.find((x) => x.id === preset.productId) ?? null;
    setProduct(p);
    if (p && !preset.locationId) setQuantity((q) => q || 1); // 從首頁「優先出貨」進來：一樣預設 1
  }, [preset.productId, preset.locationId, products.data, product]);

  const stock = useQuery({ queryKey: ["productStock", product?.id], queryFn: () => get<ProductStock>(`/products/${product!.id}/stock`), enabled: !!product });

  // 入口 B：預填該儲位的批次
  useEffect(() => {
    if (!stock.data || lines.length > 0 || !preset.locationId) return;
    const rows = stock.data.lines.filter((l) => l.location.id === preset.locationId && (!preset.batchId || l.batch.id === preset.batchId));
    const today = todayStr();
    const alert = product?.expiryAlertDays ?? 0;
    setLines(rows.map((l) => {
      const daysLeft = Math.round((Date.parse(l.batch.expiryDate) - Date.parse(today)) / 86_400_000);
      return { batchId: l.batch.id, batchNo: l.batch.batchNo, receivedDate: l.batch.receivedDate, receivedAt: l.batch.receivedAt, expiryDate: l.batch.expiryDate, expired: daysLeft < 0, daysLeft, expiringSoon: daysLeft >= 0 && daysLeft <= alert, locationId: l.location.id, locationCode: l.location.code, available: l.quantity, quantity: 0 };
    }));
  }, [stock.data, preset.locationId, preset.batchId, lines.length]);

  // 每次商品／數量改變都配一個序號；只接受最新序號的回應，舊回應一律丟掉（審查 #3）
  const suggestSeq = useRef(0);
  const suggest = useMutation({
    mutationFn: async (req: { productId: number; qty: number; seq: number }) => ({ seq: req.seq, ...(await post<FefoSuggestion>("/stock/outbound/suggest", { productId: req.productId, quantity: req.qty })) }),
    onSuccess: (s) => { if (s.seq === suggestSeq.current) setLines(s.suggestions.map((x) => ({ ...x, quantity: x.take }))); },
  });
  const suggestStale = suggest.data !== undefined && suggest.data.seq !== suggestSeq.current;
  const waitingSuggest = !preset.locationId && quantity > 0 && (suggest.isPending || suggestStale || (!confirming && suggest.data === undefined));

  // 使用者在「從哪裡拿」改數量時，上面的出庫數量會跟著改成合計；那次改動不應該重新要建議
  const syncingFromLines = useRef(false);

  // 填好數量就自動給建議（不需再按按鈕）；改數量的當下先清掉舊建議，不讓人拿舊的往下走
  useEffect(() => {
    if (preset.locationId) return;
    if (syncingFromLines.current) { syncingFromLines.current = false; return; }
    suggestSeq.current += 1;
    setLines([]);
    if (!product || quantity <= 0) { suggest.reset(); return; }
    const seq = suggestSeq.current;
    const t = setTimeout(() => suggest.mutate({ productId: product.id, qty: quantity, seq }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.id, quantity]);

  const total = lines.reduce((s, l) => s + (l.quantity || 0), 0);
  // 效期另外警示
  const expiredLines = lines.filter((l) => l.expired);
  const firstFifo = lines.findIndex((l) => !l.expired);
  const takenMinExpiry = lines.filter((l) => l.quantity > 0).reduce<string | null>((m, l) => (m === null || l.expiryDate < m ? l.expiryDate : m), null);
  const earlierExpiry = takenMinExpiry ? lines.find((l) => l.quantity === 0 && !l.expired && l.expiryDate < takenMinExpiry) ?? null : null;
  const over = lines.some((l) => l.quantity > l.available);
  const active = lines.filter((l) => l.quantity > 0);
  // 只有「建議是針對目前數量算的」時才顯示不足（手動調整過就以各儲位合計為準）
  const shortage = suggestStale || suggest.data?.requested !== quantity ? 0 : (suggest.data?.shortage ?? 0);
  // 可出庫的（未過期）一個都沒有：不要顯示「不夠 1 箱」，直接說沒有庫存
  const noStock = !preset.locationId && !suggestStale && suggest.data?.requested === quantity && suggest.data.available === 0;
  const noStockText = product ? `目前沒有可以出庫的${product.name}${expiredLines.length > 0 ? "（只剩已過期的，請改走報損或盤點處理）" : ""}` : "";

  const stepText = (() => {
    if (!product) return "要出什麼？請先選商品";
    if (preset.locationId) return lines.length === 0 ? "正在讀取這個儲位的貨…" : active.length === 0 ? `要出多少？請在取貨位置填數量（單位：${product.unit}）` : over ? "有一筆超過該儲位的數量，請改小" : "請核對後按「下一步：核對並出庫」";
    if (quantity <= 0) return `要出多少？填數量後會自動列出建議的取貨位置（單位：${product.unit}）`;
    if (waitingSuggest && lines.length === 0) return "正在找建議的取貨位置…";
    if (noStock) return noStockText;
    if (shortage > 0) return `庫存只有 ${suggest.data!.available} ${product.unit}，不夠 ${shortage} ${product.unit}；請改數量，或只出 ${suggest.data!.available} ${product.unit}`;
    if (over) return "有一筆超過該儲位的數量，請改小";
    if (active.length === 0) return "請在取貨位置填數量";
    return "已先選好「建議優先出庫」的位置（先進先出：最早進貨的先拿）；要改數量或換位置，直接改下面各儲位的數量（或點圖上的格子），確認後按「下一步：核對並出庫」";
  })();

  const m = useMutation({
    mutationFn: () => post<{ total: number }>("/stock/outbound", { productId: product!.id, lines: active.map((l) => ({ batchId: l.batchId, locationId: l.locationId, quantity: l.quantity })) }, idemKey),
    onSuccess: async () => {
      setResult(active);
      await invalidate();
      setIdemKey(crypto.randomUUID());
      setConfirming(false);
      setLines([]);
      setQuantity(preset.locationId ? 0 : 1); // 「再出庫一筆」一樣預設 1
      suggest.reset();
    },
    onError: () => setConfirming(false),
  });

  /** 改某個儲位要拿多少：限制在 0～該儲位現有數量，並把上面的出庫數量同步成合計 */
  const setQty = (i: number, q: number) => {
    const next = lines.map((l, j) => (j === i ? { ...l, quantity: Math.max(0, Math.min(l.available, Math.floor(Number.isFinite(q) ? q : 0))) } : l));
    setLines(next);
    if (!preset.locationId) {
      const sum = next.reduce((s, l) => s + l.quantity, 0);
      if (sum !== quantity) { syncingFromLines.current = true; setQuantity(sum); }
    }
  };
  const unit = product?.unit ?? "";

  // 平面圖：把要取貨的位置整格標出「取 N 箱」；點圖上有這個商品的格子可以加進來
  const activeWh = whId ?? (lines.length ? allLocs.data?.find((l) => l.id === lines.find((x) => x.quantity > 0)?.locationId)?.warehouseId : undefined) ?? warehouses.data?.items[0]?.id ?? null;
  const layout = useLayout(activeWh);
  const marks = useMemo(() => {
    const m: Record<string, { label: string; kind: "from" | "to" }> = {};
    for (const l of lines) if (l.quantity > 0) m[l.locationCode] = { label: `從這裡取 ${l.quantity} ${unit}`, kind: "from" };
    return m;
  }, [lines, unit]);
  const otherCodes = useMemo(() => new Set(lines.filter((l) => l.quantity <= 0).map((l) => l.locationCode)), [lines]);
  const [mapHint, setMapHint] = useState<string | null>(null);
  function pickOnMap(code: string | null) {
    setMapHint(null);
    if (!code) return;
    const i = lines.findIndex((l) => l.locationCode === code);
    if (i < 0) { setMapHint(`${code} 沒有「${product?.name ?? "這個商品"}」，請點有這個商品的格子。`); return; }
    if (lines[i].quantity > 0) return; // 已經要從這裡拿：數量在下面的清單改
    setQty(i, 1); // 加進來先取 1，在下面改成要的數量；上面的出庫數量會跟著變
  }

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
        <PageTitle>確認出庫</PageTitle>
        <StepBanner>請核對取貨位置與數量，按「確認出庫」才會真的扣庫存</StepBanner>
        <div className="panel space-y-3">
          <p className="text-[26px] font-bold">{product.name}，出庫 {total} {unit}</p>
          {active.map((l) => (
            <p key={`${l.batchId}-${l.locationId}`} className="text-[22px]">從 <b>{l.locationCode}</b><span className="ml-1 text-[18px] text-ink-2">（{locationWords(l.locationCode)}）</span> 取 {l.quantity} {unit}{!preset.locationId && lines.indexOf(l) === firstFifo && <span className="tag-info ml-2 align-middle">建議優先出庫</span>}<span className="ml-2 muted">進貨 {fmtReceived(l.receivedAt, l.receivedDate)}・到期 {fmtDate(l.expiryDate)}・批次 {l.batchNo}</span></p>
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
      <StepBanner>{stepText}</StepBanner>
      {m.error && <Message kind="error">{errorMessage(m.error)}</Message>}

      <Step n={1} title="要出什麼？" done={!!product}>
        <ProductSelect value={product?.id ?? null} onChange={(p) => { setProduct(p); setLines([]); suggest.reset(); if (!preset.locationId) setQuantity(p ? 1 : 0); }} allowCreate={false} />
        {stock.data && <p className="mt-3 text-[20px]">目前有 <b>{stock.data.total} {stock.data.product.unit}</b>，分在 {stock.data.lines.length} 個儲位</p>}
      </Step>

      {!preset.locationId && (
        <Step n={2} title="要出多少？" done={quantity > 0}>
          <div className="flex items-center gap-3">
            <input type="number" min={1} inputMode="numeric" className="input mt-0 max-w-[200px] text-[24px] font-bold" value={quantity || ""} onChange={(e) => setQuantity(Math.max(0, Math.floor(Number(e.target.value) || 0)))} disabled={!product} aria-label="出庫數量" />
            <span className="text-[24px] font-bold">{unit}</span>
          </div>
          {lines.length > 0 && <p className="mt-2 muted">出庫數量＝下面各取貨位置的合計；在下面改數量，這裡會自動跟著變。</p>}
          {noStock && <Message kind="warn">{noStockText}</Message>}
          {!noStock && shortage > 0 && <Message kind="warn">庫存只有 {suggest.data!.available} {unit}，不夠 {shortage} {unit}。可以先出 {suggest.data!.available} {unit}，或改數量。</Message>}
        </Step>
      )}

      <Step n={preset.locationId ? 2 : 3} title="到哪裡拿？" done={active.length > 0 && !over}>
        {lines.length === 0 ? (
          <p className="muted">{!product ? "請先選商品。" : quantity <= 0 ? "填好數量後，這裡會列出建議的取貨位置（先進先出：最早進貨的先拿）。" : waitingSuggest ? "正在找建議的取貨位置…" : noStockText || "目前沒有可以出庫的庫存。"}</p>
        ) : (
          <div className="space-y-3">
            {!preset.locationId && <p className="muted">建議優先出庫（先進先出）：系統依進貨時間，先列出最早進貨的貨；要換位置或改數量，直接改各儲位後面的數量。</p>}
            {expiredLines.length > 0 && <Message kind="warn">有 {expiredLines.length} 筆已過期（{[...new Set(expiredLines.map((l) => l.locationCode))].join("、")}），系統沒有安排出庫；請改走報損或盤點處理。</Message>}
            {earlierExpiry && <Message kind="warn">效期提醒：{earlierExpiry.locationCode} 那批較晚進貨，但 {fmtDate(earlierExpiry.expiryDate)} 就到期，比建議先拿的更早到期，請確認要不要先出那批。</Message>}
            <div className="divide-y divide-line">
              {lines.map((l, i) => {
                // 有這個商品的儲位全部列出、每格都能直接填數量；建議優先出庫＝先進先出第一個未過期的；有要拿的就是「已選」
                const recommended = i === firstFifo && !preset.locationId;
                const picked = l.quantity > 0;
                return (
                <div key={`${l.batchId}-${l.locationId}`} data-recommended={recommended || undefined} className={`flex flex-wrap items-center gap-3 py-3 ${picked ? "" : "opacity-70"} ${recommended && picked ? "rounded-[12px] border-2 border-brand bg-brand-soft px-3" : ""}`}>
                  <div className="flex-1">
                    {recommended && <p className="mb-1"><span className="inline-block rounded-md border-2 border-brand bg-white px-2 py-0.5 text-[17px] font-bold text-brand-deep">建議優先出庫（最早入庫）</span></p>}
                    <p className="text-[22px] font-bold">
                      {picked && <span className="tag-ok mr-2 align-middle">✓ 已選</span>}
                      從 {l.locationCode} 取 {picked ? `${l.quantity} ${unit}` : ""}
                    </p>
                    <p className="muted">
                      這裡有 {l.available} {unit}・進貨 {fmtReceived(l.receivedAt, l.receivedDate)}・到期 {fmtDate(l.expiryDate)}
                      {l.expired && <span className="tag-bad ml-2">已過期</span>}
                      {l.expiringSoon && <span className="tag-warn ml-2">{l.daysLeft === 0 ? "今天到期" : `${l.daysLeft} 天後到期`}</span>}
                      <span className="ml-2">批次 {l.batchNo}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="number" min={0} max={l.available} inputMode="numeric" className={`input mt-0 w-28 text-[22px] font-bold ${l.quantity > l.available ? "border-bad" : ""}`} value={l.quantity || ""} onChange={(e) => setQty(i, Number(e.target.value))} aria-label={`${l.locationCode} 出庫數量`} />
                    <span className="text-[20px]">{unit}</span>
                  </div>
                </div>
                );
              })}
            </div>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="muted">取貨位置在圖上：</span>
                <div className="flex overflow-hidden rounded-[10px] border border-line">
                  {warehouses.data?.items.map((w) => (
                    <button key={w.id} type="button" onClick={() => setWhId(w.id)} className={`min-h-[44px] px-4 text-[17px] font-medium ${w.id === activeWh ? "bg-brand-dark text-white" : "bg-white hover:bg-brand-soft"}`}>{w.name}</button>
                  ))}
                </div>
                <span className="muted">黃色＝也有這個商品但這次不取；點它可以加進來</span>
              </div>
              {mapHint && <Message kind="warn">{mapHint}</Message>}
              {layout.data && (
                <FloorplanCanvas layout={layout.data} racks={toDraft(layout.data)} editing={false} compact selectedLocation={null} selectedRackKey={null} highlightCodes={otherCodes} highlightLabel="也有貨" marks={marks} onSelectLocation={pickOnMap} onSelectRack={() => undefined} onRacksChange={() => undefined} />
              )}
            </div>
            <p className={`text-[18px] ${over ? "font-bold text-bad" : ""}`}>合計 {total} {unit}{over && "　— 有一筆超過該儲位的數量"}</p>
          </div>
        )}
      </Step>

      <Step n={preset.locationId ? 3 : 4} title="確認出庫">
        {active.length === 0 ? <p className="text-warn">請先完成上面的步驟。</p> : over ? <p className="text-bad">請把超過的數量改小。</p> : <p className="text-[20px]"><b>{product!.name}</b> 共 {total} {unit}，從 {active.map((l) => l.locationCode).join("、")} 取</p>}
        {waitingSuggest && active.length > 0 && <p className="text-warn">建議還在更新中，請稍等。</p>}
        <button type="button" className="btn-primary mt-4 w-full sm:w-auto" disabled={active.length === 0 || over || waitingSuggest} onClick={() => setConfirming(true)}>下一步：核對並出庫</button>
      </Step>
    </div>
  );
}
