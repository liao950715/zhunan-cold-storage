import { useAllLocations, type LocationOption } from "../api/hooks";

/** 儲位下拉：顯示占用狀態；`productId` 給定時，存放不同商品的儲位會標示為不可選（後端仍會驗證）。 */
export default function LocationSelect({ value, onChange, productId, exclude = [], className = "" }: { value: number | null; onChange: (loc: LocationOption | null) => void; productId?: number | null; exclude?: number[]; className?: string }) {
  const all = useAllLocations();
  const items = (all.data ?? []).filter((l) => !exclude.includes(l.id));
  return (
    <select className={`input mt-0 ${className}`} value={value ?? ""} onChange={(e) => onChange(items.find((l) => l.id === Number(e.target.value)) ?? null)}>
      <option value="">— 選擇儲位 —</option>
      {items.map((l) => {
        const conflict = !!productId && l.occupied && l.product?.id !== productId;
        const label = l.occupied ? `${l.code}（${l.product?.name} ${l.quantity} ${l.product?.unit}）` : `${l.code}（空${l.defaultCapacity ? `，容量 ${l.defaultCapacity}` : ""}）`;
        return (
          <option key={l.id} value={l.id} disabled={conflict}>
            {label}{conflict ? " ✕ 不同商品" : ""}
          </option>
        );
      })}
    </select>
  );
}
