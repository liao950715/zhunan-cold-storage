import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { errorMessage, post } from "../api/client";
import { addDays, todayStr, useAllLocations, useInvalidateStock, useProducts } from "../api/hooks";
import type { Product } from "../api/types";
import LocationSelect from "../components/LocationSelect";
import ProductSelect from "../components/ProductSelect";
import { Card, Field, Message, PageTitle } from "../components/ui";
import { useDialog } from "../components/ConfirmDialog";

interface Alloc { locationId: number | null; quantity: number }

/**
 * 雙入口入庫（FR-008～010）：
 * 入口 A 從商品開始；入口 B 由平面圖帶 ?locationId= 進來，儲位已預填。兩者共用本表單與同一後端規則。
 */
export default function Inbound() {
  const [params] = useSearchParams();
  const presetLocation = params.get("locationId") ? Number(params.get("locationId")) : null;
  const products = useProducts();
  const locations = useAllLocations();
  const invalidate = useInvalidateStock();
  const dialog = useDialog();

  const [product, setProduct] = useState<Product | null>(null);
  const [quantity, setQuantity] = useState<number>(0);
  const [expiryDate, setExpiryDate] = useState(addDays(30));
  const [receivedDate, setReceivedDate] = useState(todayStr());
  const [note, setNote] = useState("");
  const [allocs, setAllocs] = useState<Alloc[]>([{ locationId: presetLocation, quantity: 0 }]);
  const [result, setResult] = useState<{ batchNo: string; allocations: Array<{ locationCode: string; quantity: number }> } | null>(null);
  const [idemKey, setIdemKey] = useState(() => crypto.randomUUID());

  // 從儲位入口：若該儲位已有商品，自動帶入該商品（AT-18）
  useEffect(() => {
    if (!presetLocation || product || !locations.data || !products.data) return;
    const loc = locations.data.find((l) => l.id === presetLocation);
    if (loc?.product) setProduct(products.data.items.find((p) => p.id === loc.product!.id) ?? null);
  }, [presetLocation, locations.data, products.data, product]);

  const allocated = allocs.reduce((s, a) => s + (a.quantity || 0), 0);
  const mismatch = quantity > 0 && allocated !== quantity;
  const incomplete = !product || quantity <= 0 || !expiryDate || allocs.some((a) => !a.locationId || a.quantity <= 0);
  const capacityWarnings = useMemo(() => {
    if (!product || !locations.data) return [];
    return allocs.flatMap((a) => {
      const loc = locations.data.find((l) => l.id === a.locationId);
      if (!loc || loc.defaultCapacity === null) return [];
      const cap = loc.defaultCapacity;
      return loc.quantity + a.quantity > cap ? [`${loc.code} 預設容量 ${cap}，目前 ${loc.quantity}，加 ${a.quantity} 會超過（若有商品專屬容量以後端為準）`] : [];
    });
  }, [allocs, product, locations.data]);

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
      setQuantity(0);
      setAllocs([{ locationId: presetLocation, quantity: 0 }]);
      setNote("");
    },
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (incomplete || mismatch) return;
    const summary = `${product!.name} ${quantity} ${product!.unit}，到期 ${expiryDate}\n` + allocs.map((a) => `・${locations.data?.find((l) => l.id === a.locationId)?.code} ← ${a.quantity}`).join("\n");
    if (await dialog.confirm("確認入庫", summary)) m.mutate();
  }

  return (
    <div className="space-y-3">
      <PageTitle sub={presetLocation ? "從儲位入庫：儲位已帶入" : "快速入庫：選商品 → 填資料 → 分配儲位 → 確認"}>入庫</PageTitle>
      {result && (
        <Message kind="ok">
          入庫完成，批次編號 <b className="font-mono">{result.batchNo}</b>：{result.allocations.map((a) => `${a.locationCode} +${a.quantity}`).join("、")}。
          <Link className="ml-2 underline" to={`/inventory?q=${result.batchNo}`}>查看</Link>
        </Message>
      )}
      <form onSubmit={submit} className="grid gap-3 lg:grid-cols-2">
        <Card title="1. 商品">
          <ProductSelect value={product?.id ?? null} onChange={setProduct} />
          {product && <p className="mt-2 text-sm text-slate-600">單位：<b>{product.unit}</b>（自動帶入）</p>}
        </Card>
        <Card title="2. 入庫資料">
          <div className="grid grid-cols-2 gap-2">
            <Field label={`數量（${product?.unit ?? "單位"}）*`}><input type="number" min={1} className="input" value={quantity || ""} onChange={(e) => setQuantity(Number(e.target.value))} required /></Field>
            <Field label="入庫日期"><input type="date" className="input" value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} /></Field>
            <Field label="預計到期日 *" hint="由您確認，系統不推定"><input type="date" className="input" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} required /></Field>
            <Field label="備註"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          </div>
          <p className="mt-2 text-xs text-slate-500">批次編號由系統自動產生；操作者與時間自動記錄。</p>
        </Card>
        <Card title="3. 儲位分配（可分多個儲位／兩座冷凍庫）" className="lg:col-span-2">
          <div className="space-y-2">
            {allocs.map((a, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <LocationSelect className="flex-1 min-w-60" value={a.locationId} productId={product?.id} exclude={allocs.filter((_, j) => j !== i).map((x) => x.locationId!).filter(Boolean)} onChange={(loc) => setAllocs(allocs.map((x, j) => (j === i ? { ...x, locationId: loc?.id ?? null } : x)))} />
                <input type="number" min={1} className="input mt-0 w-28" placeholder="數量" value={a.quantity || ""} onChange={(e) => setAllocs(allocs.map((x, j) => (j === i ? { ...x, quantity: Number(e.target.value) } : x)))} />
                <button type="button" className="btn" disabled={allocs.length === 1} onClick={() => setAllocs(allocs.filter((_, j) => j !== i))}>移除</button>
              </div>
            ))}
            <button type="button" className="btn" onClick={() => setAllocs([...allocs, { locationId: null, quantity: 0 }])}>＋ 再加一個儲位</button>
          </div>
          <div className="mt-3 space-y-2">
            <p className={`text-sm ${mismatch ? "text-red-600" : "text-slate-600"}`}>
              分配合計 <b>{allocated}</b> / 入庫量 <b>{quantity || 0}</b>{mismatch && "　— 合計必須等於入庫量才能送出"}
            </p>
            {capacityWarnings.map((w) => <Message key={w} kind="warn">{w}</Message>)}
            {m.error && <Message kind="error">{errorMessage(m.error)}</Message>}
            <button type="submit" className="btn-primary" disabled={incomplete || mismatch || m.isPending}>{m.isPending ? "送出中…" : "確認入庫"}</button>
          </div>
        </Card>
      </form>
    </div>
  );
}
