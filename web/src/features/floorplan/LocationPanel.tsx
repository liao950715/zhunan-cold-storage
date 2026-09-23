import { useQuery } from "@tanstack/react-query";
import { get } from "../../api/client";
import type { LocationDetail } from "../../api/types";

/** 檢視模式側欄：儲位目前商品、各批次數量與容量。入庫／出庫／搬移按鈕於 Stage 4 接上表單。 */
export default function LocationPanel({ locationId, onAction }: { locationId: number; onAction?: (action: "inbound" | "outbound" | "transfer", detail: LocationDetail) => void }) {
  const q = useQuery({ queryKey: ["location", locationId], queryFn: () => get<LocationDetail>(`/locations/${locationId}`) });
  if (q.isLoading) return <p className="text-sm text-slate-500">載入中…</p>;
  if (!q.data) return <p className="text-sm text-red-600">無法載入儲位</p>;
  const d = q.data;
  const cap = d.currentProduct ? (d.capacities.find((c) => c.productId === d.currentProduct!.id)?.capacity ?? d.location.defaultCapacity) : d.location.defaultCapacity;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-[26px] font-bold">{d.location.code}</h3>
        <p className="muted">
          {d.location.warehouseCode} 冷凍庫 · 貨架 {d.location.rackCode}
        </p>
      </div>
      {d.currentProduct ? (
        <div className="rounded-lg bg-ok-soft p-4">
          <p className="text-[16px] font-medium text-ok">有貨</p>
          <p className="text-[24px] font-bold">{d.currentProduct.name}</p>
          <p className="text-[20px]">
            {d.occupied} {d.currentProduct.unit}
            {cap !== null && <span className="text-slate-500"> / 容量 {cap}</span>}
          </p>
        </div>
      ) : (
        <div className="rounded-lg bg-bg p-4 text-[20px]">
          空的{d.location.defaultCapacity !== null && `（預設容量 ${d.location.defaultCapacity}）`}
        </div>
      )}
      {d.lines.length > 0 && (
        <table className="w-full text-[16px]">
          <thead className="text-slate-500">
            <tr>
              <th className="text-left font-normal">批次</th>
              <th className="text-left font-normal">到期日</th>
              <th className="text-right font-normal">數量</th>
            </tr>
          </thead>
          <tbody>
            {d.lines.map((l) => (
              <tr key={l.inventoryId} className="border-t border-slate-100">
                <td className="py-1 font-mono">{l.batch.batchNo}</td>
                <td>{l.batch.expiryDate}</td>
                <td className="text-right">{l.quantity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="flex flex-wrap gap-2 pt-1">
        <button className="btn" onClick={() => onAction?.("inbound", d)}>放貨到這裡（入庫）</button>
        {d.occupied > 0 && (
          <>
            <button className="btn-primary" onClick={() => onAction?.("outbound", d)}>從這裡取貨（出庫）</button>
            <button className="btn" onClick={() => onAction?.("transfer", d)}>搬到別的儲位</button>
          </>
        )}
      </div>
    </div>
  );
}
