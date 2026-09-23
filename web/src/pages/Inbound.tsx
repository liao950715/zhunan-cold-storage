import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { errorMessage, post } from "../api/client";
import { addDays, todayStr, useAllLocations, useInvalidateStock, useProducts } from "../api/hooks";
import type { Product } from "../api/types";
import LocationSelect from "../components/LocationSelect";
import ProductSelect from "../components/ProductSelect";
import { Collapsible, Field, Message, PageTitle, Step, fmtDate } from "../components/ui";
import { locationWords } from "../lib/words";

interface Alloc { locationId: number | null; quantity: number }

/**
 * 入庫（FR-008～010）：單欄由上而下 1 商品 → 2 數量 → 3 到期日 → 4 位置 → 5 核對並入庫。
 * 預設一個儲位、數量自動帶入；要拆放才展開「分到其他儲位」。從平面圖帶 ?locationId= 進來時位置已選好。
 */
export default function Inbound() {
  const [params] = useSearchParams();
  const presetLocation = params.get("locationId") ? Number(params.get("locationId")) : null;
  const products = useProducts();
  const locations = useAllLocations();
  const invalidate = useInvalidateStock();

  const [product, setProduct] = useState<Product | null>(null);
  const [quantity, setQuantity] = useState(0);
  const [expiryDate, setExpiryDate] = useState(addDays(30));
  const [receivedDate, setReceivedDate] = useState(todayStr());
  const [note, setNote] = useState("");
  const [allocs, setAllocs] = useState<Alloc[]>([{ locationId: presetLocation, quantity: 0 }]);
  const [split, setSplit] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<{ batchNo: string; allocations: Array<{ locationCode: string; quantity: number }> } | null>(null);
  const [idemKey, setIdemKey] = useState(() => crypto.randomUUID());

  // 從儲位入口：若該儲位已有商品，自動帶入該商品（AT-18）
  useEffect(() => {
    if (!presetLocation || product || !locations.data || !products.data) return;
    const loc = locations.data.find((l) => l.id === presetLocation);
    if (loc?.product) setProduct(products.data.items.find((p) => p.id === loc.product!.id) ?? null);
  }, [presetLocation, locations.data, products.data, product]);

  // 未拆放時，唯一儲位的數量自動等於入庫量
  useEffect(() => {
    if (!split) setAllocs((a) => [{ locationId: a[0]?.locationId ?? null, quantity }]);
  }, [quantity, split]);

  const locName = (id: number | null) => locations.data?.find((l) => l.id === id);
  const allocated = allocs.reduce((s, a) => s + (a.quantity || 0), 0);
  const mismatch = split && quantity > 0 && allocated !== quantity;
  const missing: string[] = [];
  if (!product) missing.push("選擇商品");
  if (quantity <= 0) missing.push("輸入數量");
  if (!expiryDate) missing.push("填到期日");
  if (allocs.some((a) => !a.locationId)) missing.push("選擇放置位置");
  if (split && allocs.some((a) => a.quantity <= 0)) missing.push("填每個儲位的數量");
  if (mismatch) missing.push(`分配合計 ${allocated} 要等於入庫量 ${quantity}`);

  const capacityWarnings = allocs.flatMap((a) => {
    const loc = locName(a.locationId);
    if (!loc || loc.defaultCapacity === null) return [];
    return loc.quantity + a.quantity > loc.defaultCapacity ? [`${loc.code} 容量 ${loc.defaultCapacity}，目前已放 ${loc.quantity}，再放 ${a.quantity} 會超過。請減少數量或改放其他儲位。`] : [];
  });

  const m = useMutation({
    mutationFn: () =>
      post<{ batch: { batchNo: string }; allocations: Array<{ locationCode: string; quantity: number }> }>(
        "/stock/inbound",
        { productId: product!.id, quantity, expiryDate, receivedDate, note: note || null, allocations: allocs.map((a) => ({ locationId: a.locationId!, quantity: a.quantity })) },
        idemKey,
      ),
    onSuccess: async (r) => {
      setResult({ batchNo: r.batch.batchNo, allocations: r.allocations });
      await invalidate();
      setIdemKey(crypto.randomUUID());
      setConfirming(false);
      setQuantity(0);
      setSplit(false);
      setAllocs([{ locationId: presetLocation, quantity: 0 }]);
      setNote("");
    },
    onError: () => setConfirming(false),
  });

  if (result) {
    return (
      <div className="space-y-5">
        <PageTitle>入庫完成</PageTitle>
        <div className="panel space-y-3 border-l-8 border-ok">
          <p className="text-[26px] font-bold text-ok">✓ 入庫完成</p>
          <p className="text-[22px] font-bold">{product?.name}，共 {result.allocations.reduce((s, a) => s + a.quantity, 0)} {product?.unit}</p>
          {result.allocations.map((a) => <p key={a.locationCode} className="text-[20px]">放在 <b>{a.locationCode}</b>：{a.quantity} {product?.unit}</p>)}
          <p className="muted">批次編號 {result.batchNo}（系統自動產生）</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button className="btn-primary" onClick={() => setResult(null)}>再入庫一筆</button>
          <Link className="btn" to={`/inventory?q=${encodeURIComponent(product?.name ?? "")}`}>查看這個商品的庫存</Link>
          <Link className="btn" to="/">回首頁</Link>
        </div>
      </div>
    );
  }

  if (confirming && product) {
    return (
      <div className="space-y-5">
        <PageTitle sub="請核對下面的資料">確認入庫</PageTitle>
        <div className="panel space-y-3">
          <p className="text-[26px] font-bold">{product.name}，入庫 {quantity} {product.unit}</p>
          {allocs.map((a, i) => {
            const loc = locName(a.locationId);
            return <p key={i} className="text-[22px]">放在 <b>{loc?.code}</b><span className="ml-2 text-[18px] text-ink-2">{loc ? locationWords(loc.code) : ""}</span>{split && <>：{a.quantity} {product.unit}</>}</p>;
          })}
          <p className="text-[20px]">到期日 {fmtDate(expiryDate)}</p>
          {(receivedDate !== todayStr() || note) && <p className="muted">入庫日期 {fmtDate(receivedDate)}{note && `・備註：${note}`}</p>}
        </div>
        {m.error && <Message kind="error">{errorMessage(m.error)}</Message>}
        <div className="flex flex-wrap gap-3">
          <button className="btn" onClick={() => setConfirming(false)}>返回修改</button>
          <button className="btn-primary" onClick={() => m.mutate()} disabled={m.isPending}>{m.isPending ? "入庫中…" : "確認入庫"}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageTitle sub={presetLocation ? `放置位置已選好：${locName(presetLocation)?.code ?? ""}` : "照順序填好，最後核對再入庫"}>入庫</PageTitle>
      {m.error && <Message kind="error">{errorMessage(m.error)}</Message>}

      <Step n={1} title="選擇商品" done={!!product}>
        <ProductSelect value={product?.id ?? null} onChange={setProduct} />
      </Step>

      <Step n={2} title="輸入數量" done={quantity > 0}>
        <div className="flex items-center gap-3">
          <input type="number" min={1} inputMode="numeric" className="input mt-0 max-w-[200px] text-[24px] font-bold" value={quantity || ""} onChange={(e) => setQuantity(Number(e.target.value))} aria-label="數量" />
          <span className="text-[24px] font-bold">{product?.unit ?? ""}</span>
        </div>
      </Step>

      <Step n={3} title="確認到期日" done={!!expiryDate}>
        <div className="mb-3 flex flex-wrap gap-2">
          {[7, 14, 30, 60].map((d) => (
            <button key={d} type="button" className={expiryDate === addDays(d) ? "btn-primary" : "btn"} onClick={() => setExpiryDate(addDays(d))}>{d} 天後</button>
          ))}
        </div>
        <input type="date" className="input mt-0 max-w-[260px]" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} aria-label="到期日" />
        <p className="mt-1 muted">請依實際保存期限填寫或修改，系統不會自行推算。目前：{fmtDate(expiryDate)}</p>
      </Step>

      <Step n={4} title="選擇放置位置" done={allocs.every((a) => a.locationId) && !mismatch}>
        <div className="space-y-3">
          {allocs.map((a, i) => (
            <div key={i} className="flex flex-wrap items-center gap-3">
              <LocationSelect className="flex-1 min-w-[260px]" value={a.locationId} productId={product?.id} exclude={allocs.filter((_, j) => j !== i).map((x) => x.locationId!).filter(Boolean)} onChange={(loc) => setAllocs(allocs.map((x, j) => (j === i ? { ...x, locationId: loc?.id ?? null } : x)))} />
              {split && (
                <>
                  <input type="number" min={1} inputMode="numeric" className="input mt-0 w-32 text-[22px] font-bold" placeholder="數量" value={a.quantity || ""} onChange={(e) => setAllocs(allocs.map((x, j) => (j === i ? { ...x, quantity: Number(e.target.value) } : x)))} aria-label={`第 ${i + 1} 個儲位數量`} />
                  <span className="text-[20px]">{product?.unit}</span>
                  <button type="button" className="btn-sm" disabled={allocs.length === 1} onClick={() => setAllocs(allocs.filter((_, j) => j !== i))}>移除</button>
                </>
              )}
            </div>
          ))}
          {!split ? (
            <button type="button" className="btn-sm" onClick={() => { setSplit(true); const first = Math.ceil(quantity / 2); setAllocs([{ ...allocs[0], quantity: first }, { locationId: null, quantity: quantity - first }]); }}>分到其他儲位</button>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className="btn-sm" onClick={() => setAllocs([...allocs, { locationId: null, quantity: 0 }])}>＋ 再加一個儲位</button>
              <button type="button" className="btn-sm" onClick={() => { setSplit(false); setAllocs([{ locationId: allocs[0].locationId, quantity }]); }}>只放一個儲位</button>
              <span className={`text-[18px] ${mismatch ? "font-bold text-bad" : "text-ink-2"}`}>{mismatch ? (allocated < quantity ? `還有 ${quantity - allocated} ${product?.unit ?? ""} 沒分配` : `多分配了 ${allocated - quantity} ${product?.unit ?? ""}`) : `分配合計 ${allocated} / 入庫量 ${quantity}`}</span>
            </div>
          )}
          {capacityWarnings.map((w) => <Message key={w} kind="warn">{w}</Message>)}
        </div>
      </Step>

      <Collapsible label="其他資料（入庫日期、備註）">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="入庫日期"><input type="date" className="input" value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} /></Field>
          <Field label="備註"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </div>
      </Collapsible>

      <Step n={5} title="核對資料並入庫">
        {missing.length > 0 ? (
          <p className="text-[18px] text-warn">還差：{missing.join("、")}</p>
        ) : (
          <p className="text-[20px]"><b>{product!.name}</b> {quantity} {product!.unit}，放在 <b>{allocs.map((a) => locName(a.locationId)?.code).join("、")}</b>，到期 {fmtDate(expiryDate)}</p>
        )}
        <button type="button" className="btn-primary mt-4 w-full sm:w-auto" disabled={missing.length > 0} onClick={() => setConfirming(true)}>下一步：核對並入庫</button>
      </Step>
    </div>
  );
}
