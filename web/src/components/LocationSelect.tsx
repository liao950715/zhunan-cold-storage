import { useAllLocations, type LocationOption } from "../api/hooks";

/** 儲位下拉：文字寫明「空」或「有 ○○」；`productId` 給定時，放了不同商品的儲位不可選（後端仍會驗證）。 */
export default function LocationSelect({ value, onChange, productId, exclude = [], className = "" }: { value: number | null; onChange: (loc: LocationOption | null) => void; productId?: number | null; exclude?: number[]; className?: string }) {
  const all = useAllLocations();
  const items = (all.data ?? []).filter((l) => !exclude.includes(l.id));
  return (
    <select className={`input mt-0 ${className}`} value={value ?? ""} onChange={(e) => onChange(items.find((l) => l.id === Number(e.target.value)) ?? null)} aria-label="儲位">
      <option value="">— 請選擇儲位 —</option>
      {items.map((l) => {
        const conflict = !!productId && l.occupied && l.product?.id !== productId;
        const label = l.occupied ? `${l.code}　有 ${l.product?.name} ${l.quantity} ${l.product?.unit}` : `${l.code}　空${l.defaultCapacity ? `（可放 ${l.defaultCapacity}）` : ""}`;
        return (
          <option key={l.id} value={l.id} disabled={conflict}>
            {label}{conflict ? "　✕ 放了別的商品" : ""}
          </option>
        );
      })}
    </select>
  );
}
