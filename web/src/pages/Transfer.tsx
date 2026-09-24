import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { errorMessage, get, post } from "../api/client";
import { useAllLocations, useInvalidateStock, useLayout, useWarehouses } from "../api/hooks";
import type { LocationDetail } from "../api/types";
import FloorplanCanvas from "../features/floorplan/FloorplanCanvas";
import { toDraft } from "../features/floorplan/geometry";
import { Message, PageTitle, StepBanner, fmtDate } from "../components/ui";
import { locationWords } from "../lib/words";

type Phase = "from" | "batch" | "to" | "confirm";

/**
 * FR-013 搬移：一張共用平面圖 ＋ 固定顯示的「① 從這裡搬出 ／ ② 搬到這裡」摘要。
 * 順序：選起點 → 填批次與數量 → 選終點 → 確認。每一步只做一件事；換起點會清掉批次、數量與終點。
 */
export default function Transfer() {
  const [params] = useSearchParams();
  const invalidate = useInvalidateStock();
  const warehouses = useWarehouses();
  const all = useAllLocations();

  const [fromId, setFromId] = useState<number | null>(Number(params.get("locationId")) || null);
  const [batchId, setBatchId] = useState<number | null>(Number(params.get("batchId")) || null);
  const [quantity, setQuantity] = useState(0);
  const [toId, setToId] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>(fromId ? "batch" : "from");
  const [whId, setWhId] = useState<number | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [idemKey, setIdemKey] = useState(() => crypto.randomUUID());
  const qtyRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  // 選好起點 → 帶到數量欄；選好終點 → 帶到確認區；要選終點 → 帶到圖／列表（不用自己找下一步在哪）
  useEffect(() => {
    const t = setTimeout(() => {
      if (phase === "batch") { qtyRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }); qtyRef.current?.focus({ preventScroll: true }); }
      if (phase === "confirm") { confirmRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }); confirmRef.current?.querySelector<HTMLButtonElement>("button.btn-primary")?.focus({ preventScroll: true }); }
      if (phase === "to") mapRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    }, 50);
    return () => clearTimeout(t);
  }, [phase, fromId, toId]);

  const fromLoc = all.data?.find((l) => l.id === fromId) ?? null;
  const toLoc = all.data?.find((l) => l.id === toId) ?? null;
  const from = useQuery({ queryKey: ["location", fromId], queryFn: () => get<LocationDetail>(`/locations/${fromId}`), enabled: !!fromId });
  const line = from.data?.lines.find((l) => l.batch.id === batchId) ?? (from.data?.lines.length === 1 ? from.data.lines[0] : null);
  useEffect(() => { if (line && batchId !== line.batch.id) setBatchId(line.batch.id); }, [line, batchId]);
  const productId = from.data?.currentProduct?.id ?? null;

  const activeWh = whId ?? fromLoc?.warehouseId ?? warehouses.data?.items[0]?.id ?? null;
  const layout = useLayout(activeWh);
  useEffect(() => { if (fromLoc && phase === "from") setWhId(fromLoc.warehouseId); }, [fromLoc?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const marks = useMemo(() => {
    const m: Record<string, { label: string; kind: "from" | "to" }> = {};
    if (fromLoc) m[fromLoc.code] = { label: "① 從這裡搬出", kind: "from" };
    if (toLoc) m[toLoc.code] = { label: "② 搬到這裡", kind: "to" };
    return m;
  }, [fromLoc, toLoc]);

  function resetAll() { setFromId(null); setBatchId(null); setQuantity(0); setToId(null); setPhase("from"); setHint(null); }
  function changeFrom() { setBatchId(null); setQuantity(0); setToId(null); setPhase("from"); setHint(null); }
  function changeTo() { setToId(null); setPhase("to"); setHint(null); }

  function pick(code: string | null) {
    setHint(null);
    if (!code) return;
    const loc = all.data?.find((l) => l.code === code);
    if (!loc) return;
    if (phase === "from" || phase === "batch") {
      if (!loc.occupied) { setHint(`${loc.code} 這裡沒有貨，請選有貨的位置。`); return; }
      if (loc.id !== fromId) { setFromId(loc.id); setBatchId(null); setQuantity(0); setToId(null); }
      setPhase("batch");
      return;
    }
    if (phase === "to" || phase === "confirm") {
      if (loc.id === fromId) { setHint("這是搬出的位置，請選另一個儲位。"); return; }
      if (productId && loc.occupied && loc.product?.id !== productId) { setHint(`${loc.code} 放了「${loc.product?.name}」，不能放不同的商品。請選空位或放同一商品的儲位。`); return; }
      if (loc.occupied && loc.capacity !== null && loc.quantity >= loc.capacity) { setHint(`${loc.code} 已滿（${loc.quantity}/${loc.capacity}），請選別的儲位。`); return; }
      setToId(loc.id);
      setPhase("confirm");
    }
  }

  const qtyOk = !!line && quantity > 0 && quantity <= line.quantity;
  const m = useMutation({
    mutationFn: () => post<{ batchNo: string; from: { code: string; after: number }; to: { code: string; after: number } }>("/stock/transfer", { batchId: line!.batch.id, fromLocationId: fromId, toLocationId: toId, quantity }, idemKey),
    onSuccess: async (r) => {
      setResult(`${line!.product.name} ${quantity} ${line!.product.unit}，從 ${r.from.code} 搬到 ${r.to.code}。${r.from.code} 剩 ${r.from.after}、${r.to.code} 現有 ${r.to.after}（商品總量不變）。`);
      await invalidate();
      setIdemKey(crypto.randomUUID());
      resetAll();
    },
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

  const stepText: Record<Phase, string> = {
    from: "請在下方列表或平面圖點選「從哪裡搬出」（要有貨的位置）",
    batch: "填好要搬的批次和數量，再按「下一步：選搬到哪裡」",
    to: "現在請在下方列表或平面圖點選「搬到哪裡」",
    confirm: "請核對下方摘要，按「確認搬移」才會執行",
  };

  return (
    <div className="space-y-5">
      <PageTitle sub="把同一批貨的一部分，從一個儲位搬到另一個儲位；商品總量不變">搬移貨物</PageTitle>
      {m.error && <Message kind="error">{errorMessage(m.error)}</Message>}

      {/* 目前步驟：釘在最上方 */}
      <StepBanner>{stepText[phase]}</StepBanner>

      {/* 起點／終點摘要：手機也兩格並排、精簡一行，不佔掉整個首屏 */}
      <div className="grid grid-cols-2 gap-2 sm:gap-3">
        <div className={`rounded-[14px] p-3 sm:p-4 ${fromLoc ? "bg-[#5a8199] text-white" : "border-2 border-dashed border-line bg-white"}`}>
          <p className="text-[16px] font-bold sm:text-[18px]">① 從這裡搬出</p>
          {fromLoc ? (
            <>
              <p className="text-[24px] font-bold sm:text-[26px]">{fromLoc.code}</p>
              <p className="hidden text-[18px] sm:block">{locationWords(fromLoc.code)}・{fromLoc.product?.name}，目前 {fromLoc.quantity} {fromLoc.product?.unit}</p>
              <p className="text-[16px] sm:hidden">{fromLoc.product?.name} {fromLoc.quantity} {fromLoc.product?.unit}</p>
              <button type="button" className="btn-sm mt-2 text-ink" onClick={changeFrom}>更換</button>
            </>
          ) : (
            <p className="text-[18px] text-ink-2 sm:text-[20px]">尚未選擇</p>
          )}
        </div>
        <div className={`rounded-[14px] p-3 sm:p-4 ${toLoc ? "border-4 border-[#754000] bg-[#ffb454] text-[#2b2118]" : "border-2 border-dashed border-line bg-white"}`}>
          <p className="text-[16px] font-bold sm:text-[18px]">② 搬到這裡</p>
          {toLoc ? (
            <>
              <p className="text-[24px] font-bold sm:text-[26px]">{toLoc.code}</p>
              <p className="hidden text-[18px] sm:block">{locationWords(toLoc.code)}・{toLoc.occupied ? `有 ${toLoc.product?.name} ${toLoc.quantity} ${toLoc.product?.unit}` : "空位"}</p>
              <p className="text-[16px] sm:hidden">{toLoc.occupied ? `${toLoc.product?.name} ${toLoc.quantity} ${toLoc.product?.unit}` : "空位"}</p>
              <button type="button" className="btn-sm mt-2 border-[#754000] text-ink" onClick={changeTo}>更換</button>
            </>
          ) : (
            <p className="text-[18px] text-ink-2 sm:text-[20px]">{phase === "from" || phase === "batch" ? "先選搬出位置" : "尚未選擇"}</p>
          )}
        </div>
      </div>

      {/* 批次與數量（起點選好後） */}
      {fromLoc && from.data && (
        <div className="panel space-y-3">
          <h2 className="text-[20px] font-bold">搬哪一批、搬多少？</h2>
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
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-[18px]">搬多少：</span>
              <input ref={qtyRef} type="number" min={1} max={line.quantity} inputMode="numeric" className="input mt-0 max-w-[180px] text-[24px] font-bold" value={quantity || ""} onChange={(e) => setQuantity(Number(e.target.value))} aria-label="搬移數量" />
              <span className="text-[24px] font-bold">{line.product.unit}</span>
              <span className="muted">這裡有 {line.quantity} {line.product.unit}・批次 {line.batch.batchNo}・到期 {fmtDate(line.batch.expiryDate)}</span>
            </div>
          )}
          {line && quantity > line.quantity && <p className="text-bad">最多只能搬 {line.quantity} {line.product.unit}。</p>}
          {phase === "batch" && (
            <button type="button" className="btn-primary" disabled={!qtyOk} onClick={() => setPhase("to")}>{qtyOk ? "下一步：選搬到哪裡" : "請先填好批次與數量"}</button>
          )}
        </div>
      )}

      {/* 最後確認（緊接在批次數量下方，要改數量不必往下滑） */}
      {phase === "confirm" && fromLoc && toLoc && line && (
        <div ref={confirmRef} className="panel space-y-3 border-l-8 border-[#754000]">
          <p className="text-[26px] font-bold">{line.product.name} {quantity} {line.product.unit}，從 {fromLoc.code} → {toLoc.code}</p>
          <p className="muted">批次 {line.batch.batchNo}・{locationWords(fromLoc.code)} → {locationWords(toLoc.code)}・商品總量不變</p>
          {!qtyOk && <p className="text-warn">請先在上面填好數量。</p>}
          <div className="flex flex-wrap gap-3">
            <button type="button" className="btn" onClick={changeTo}>更換搬到位置</button>
            <button type="button" className="btn-primary" disabled={!qtyOk || m.isPending} onClick={() => m.mutate()}>{m.isPending ? "搬移中…" : "確認搬移"}</button>
          </div>
        </div>
      )}

      <div ref={mapRef} className="flex flex-wrap items-center gap-3 scroll-mt-20">
        <div className="flex overflow-hidden rounded-[10px] border border-line">
          {warehouses.data?.items.map((w) => (
            <button key={w.id} type="button" onClick={() => setWhId(w.id)} className={`min-h-[52px] px-5 text-[18px] font-medium ${w.id === activeWh ? "bg-brand-dark text-white" : "bg-white hover:bg-brand-soft"}`}>{w.name}</button>
          ))}
        </div>
        <span className="muted">起點與終點可以在不同冷凍庫；上方摘要會一直保留。</span>
        <button type="button" className="btn-sm ml-auto" onClick={resetAll} disabled={!fromId && !toId}>清除重選</button>
      </div>
      {hint && <Message kind="warn">{hint}</Message>}
      {layout.data && (
        <FloorplanCanvas layout={layout.data} racks={toDraft(layout.data)} editing={false} selectedLocation={null} selectedRackKey={null} highlightCodes={new Set()} marks={marks} onSelectLocation={pick} onSelectRack={() => undefined} onRacksChange={() => undefined} />
      )}

      {/* 手機：主要按鈕固定在畫面底部（避開瀏覽器工具列的安全區），選完不用往上找 */}
      {(phase === "batch" || phase === "confirm") && fromLoc && (
        <div className="sticky bottom-0 z-20 -mx-4 border-t border-line bg-white/95 px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 backdrop-blur lg:hidden">
          {phase === "batch" ? (
            <button type="button" className="btn-primary w-full" disabled={!qtyOk} onClick={() => setPhase("to")}>{qtyOk ? "下一步：選搬到哪裡" : "請先填好批次與數量"}</button>
          ) : (
            <button type="button" className="btn-primary w-full" disabled={!qtyOk || m.isPending || !toLoc} onClick={() => m.mutate()}>{m.isPending ? "搬移中…" : `確認搬移：${fromLoc.code} → ${toLoc?.code ?? "?"}`}</button>
          )}
        </div>
      )}
    </div>
  );
}
