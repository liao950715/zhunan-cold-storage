import { useQuery } from "@tanstack/react-query";
import { get } from "../../api/client";
import type { LocationDetail } from "../../api/types";
import { fmtDate } from "../../components/ui";
import { locationWords } from "../../lib/words";

/** 檢視模式側欄：儲位目前商品、各批次數量與容量，以及入庫／出庫／搬移入口。 */
export default function LocationPanel({ locationId, onAction }: { locationId: number; onAction?: (action: "inbound" | "outbound" | "transfer", detail: LocationDetail) => void }) {
  const q = useQuery({ queryKey: ["location", locationId], queryFn: () => get<LocationDetail>(`/locations/${locationId}`) });
  if (q.isLoading) return <p className="muted">載入中…</p>;
  if (!q.data) return <p className="text-bad">無法載入儲位</p>;
  const d = q.data;
  const cap = d.currentProduct ? (d.capacities.find((c) => c.productId === d.currentProduct!.id)?.capacity ?? d.location.defaultCapacity) : d.location.defaultCapacity;
  const full = cap !== null && d.occupied >= cap;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-[26px] font-bold">{d.location.code}</h3>
        <p className="muted">{locationWords(d.location.code)}</p>
      </div>
      {d.currentProduct ? (
        <div className={`rounded-[10px] p-4 ${full ? "bg-[#a4262c] text-white" : "bg-[#d9eaf7]"}`}>
          <p className="text-[18px] font-bold">{full ? "已滿" : "有貨"}</p>
          <p className="text-[24px] font-bold">{d.currentProduct.name}</p>
          <p className="text-[20px]">{d.occupied} {d.currentProduct.unit}{cap !== null ? <span className={full ? "text-white/90" : "text-ink-2"}> / 容量 {cap}</span> : <span className="text-ink-2">（未設定容量）</span>}</p>
        </div>
      ) : (
        <div className="rounded-[10px] bg-bg-2 p-4 text-[20px]">空位{d.location.defaultCapacity !== null && <span className="muted">（可放 {d.location.defaultCapacity}）</span>}</div>
      )}
      {d.lines.length > 0 && (
        <div className="divide-y divide-line">
          {d.lines.map((l) => (
            <div key={l.inventoryId} className="flex items-center justify-between py-2 text-[16px]">
              <span>到期 {fmtDate(l.batch.expiryDate)}<span className="ml-2 text-ink-2">批次 {l.batch.batchNo}</span></span>
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
    </div>
  );
}
