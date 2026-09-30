import { useQuery } from "@tanstack/react-query";
import { get } from "../../api/client";
import type { LocationDetail, Movement } from "../../api/types";
import { TYPE_LABEL, fmtClock, fmtDate, fmtReceived } from "../../components/ui";
import { locationWords } from "../../lib/words";

/** 盤點調整的原因「盤點 #3 核准調整（系統 20→實盤 19）・原因：腐爛／損壞，無法販售・審核備註：…」→ 只取原因那段 */
const stocktakeReason = (reason: string | null) => reason?.match(/・原因：(.*?)(?:・審核備註：|$)/)?.[1] ?? reason;

/** 以「這個儲位」的角度描述一筆異動：放進來是 +、拿出去是 −；報損、盤點調整、復原附原因。 */
function describe(m: Movement, locationId: number) {
  const incoming = m.toLocationId === locationId;
  const label = m.type === "TRANSFER"
    ? (incoming ? `搬移（從 ${m.fromLocation?.code ?? "別的儲位"} 搬來）` : `搬移（搬到 ${m.toLocation?.code ?? "別的儲位"}）`)
    : TYPE_LABEL[m.type] ?? m.type;
  const reason = m.type === "DAMAGE" ? m.reason : m.type === "ADJUSTMENT" ? stocktakeReason(m.reason) : m.type === "REVERSAL" ? m.reversalReason : null;
  return { label, incoming, quantity: `${incoming ? "+" : "−"}${m.quantity} ${m.product.unit}`, reason };
}

/** 檢視模式側欄：儲位目前商品、各批次數量與容量，以及入庫／出庫／搬移入口；最下面是最近一筆異動。 */
export default function LocationPanel({ locationId, onAction }: { locationId: number; onAction?: (action: "inbound" | "outbound" | "transfer", detail: LocationDetail) => void }) {
  const q = useQuery({ queryKey: ["location", locationId], queryFn: () => get<LocationDetail>(`/locations/${locationId}`) });
  // 沿用異動紀錄 API（依儲位篩選、最新的在前），只取一筆；庫存操作後 ["movements"] 會失效重抓
  const last = useQuery({ queryKey: ["movements", "location", locationId], queryFn: () => get<{ items: Movement[] }>(`/movements?locationId=${locationId}&limit=1`) });
  if (q.isLoading) return <p className="muted">載入中…</p>;
  if (!q.data) return <p className="text-bad">無法載入儲位</p>;
  const d = q.data;
  const cap = d.currentProduct ? (d.capacities.find((c) => c.productId === d.currentProduct!.id)?.capacity ?? d.location.defaultCapacity) : d.location.defaultCapacity;
  const full = cap !== null && d.occupied >= cap;
  const latest = last.data?.items[0];
  const shown = latest ? describe(latest, locationId) : null;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-[26px] font-bold">{d.location.code}</h3>
        <p className="muted">{locationWords(d.location.code)}</p>
      </div>
      {d.currentProduct ? (
        <div className={`rounded-[10px] p-4 ${full ? "bg-[#a4262c] text-white" : "bg-[#1f6b3a] text-white"}`}>
          <p className="text-[18px] font-bold">{full ? "已滿" : "有貨"}</p>
          <p className="text-[24px] font-bold">{d.currentProduct.name}</p>
          <p className="text-[20px]">{d.occupied} {d.currentProduct.unit}{cap !== null ? <span className="text-white/90"> / 容量 {cap}</span> : <span className="text-white/90">（未設定容量）</span>}</p>
        </div>
      ) : (
        <div className="rounded-[10px] bg-bg-2 p-4 text-[20px]">空位{d.location.defaultCapacity !== null && <span className="muted">（可放 {d.location.defaultCapacity}）</span>}</div>
      )}
      {d.lines.length > 0 && (
        <div className="divide-y divide-line">
          {d.lines.map((l) => (
            <div key={l.inventoryId} className="flex items-center justify-between py-2 text-[16px]">
              <span>進貨 {fmtReceived(l.batch.receivedAt, l.batch.receivedDate)}・到期 {fmtDate(l.batch.expiryDate)}<span className="ml-2 text-ink-2">批次 {l.batch.batchNo}</span></span>
              <b>{l.quantity} {l.product.unit}</b>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-col gap-2 pt-1">
        {d.occupied > 0 && <button className="btn-primary" onClick={() => onAction?.("outbound", d)}>從這裡取貨（出庫）</button>}
        {!full && <button className="btn" onClick={() => onAction?.("inbound", d)}>放貨到這裡（入庫）</button>}
        {d.occupied > 0 && <button className="btn" onClick={() => onAction?.("transfer", d)}>搬到別的儲位</button>}
      </div>
      <section aria-label="最近一筆異動紀錄" className="space-y-2 border-t border-line pt-4">
        <h4 className="text-[20px] font-bold">最近一筆異動紀錄</h4>
        {last.isLoading ? (
          <p className="muted">讀取中…</p>
        ) : last.isError ? (
          <p className="text-bad">無法讀取異動紀錄</p>
        ) : !latest || !shown ? (
          <p className="text-[18px] text-ink-2">尚無異動紀錄</p>
        ) : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[18px]">
            <dt className="text-ink-2">最近異動</dt><dd className="font-bold">{shown.label}</dd>
            <dt className="text-ink-2">商品</dt><dd>{latest.productNameSnapshot}</dd>
            <dt className="text-ink-2">數量</dt><dd className={`font-bold ${shown.incoming ? "text-ok" : "text-bad"}`}>{shown.quantity}</dd>
            {shown.reason && <><dt className="text-ink-2">原因</dt><dd>{shown.reason}</dd></>}
            <dt className="text-ink-2">時間</dt><dd>{fmtClock(latest.createdAt)}</dd>
          </dl>
        )}
      </section>
    </div>
  );
}
