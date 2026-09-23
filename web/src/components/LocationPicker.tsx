import { useEffect, useMemo, useState } from "react";
import { useAllLocations, useLayout, useWarehouses, type LocationOption } from "../api/hooks";
import FloorplanCanvas from "../features/floorplan/FloorplanCanvas";
import { toDraft } from "../features/floorplan/geometry";
import LocationSelect from "./LocationSelect";
import { Message } from "./ui";

interface Props {
  value: number | null;
  onChange: (loc: LocationOption | null) => void;
  productId?: number | null;
  exclude?: number[];
  /** 同一筆操作中其他已選的儲位（一起在圖上標出來） */
  alsoHighlight?: number[];
  label?: string;
  /** stocked：只能選有貨的儲位（報損、搬出等） */
  mode?: "any" | "stocked";
}

/**
 * 儲位選擇＝下拉＋平面圖：下拉選哪個，圖上就亮哪個；直接點圖上的格子也能選。
 * 放了別的商品或已滿的儲位點了會說明原因，不會選進去。
 */
export default function LocationPicker({ value, onChange, productId, exclude = [], alsoHighlight = [], label = "已選", mode = "any" }: Props) {
  const warehouses = useWarehouses();
  const all = useAllLocations();
  const selected = all.data?.find((l) => l.id === value) ?? null;
  const [whId, setWhId] = useState<number | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const activeWh = whId ?? selected?.warehouseId ?? warehouses.data?.items[0]?.id ?? null;
  const layout = useLayout(activeWh);

  // 下拉選了別的冷凍庫的儲位 → 圖切到那座
  useEffect(() => { if (selected) setWhId(selected.warehouseId); }, [selected?.warehouseId]); // eslint-disable-line react-hooks/exhaustive-deps

  const highlight = useMemo(() => new Set((all.data ?? []).filter((l) => alsoHighlight.includes(l.id) && l.id !== value).map((l) => l.code)), [all.data, alsoHighlight, value]);

  function pick(code: string | null) {
    setHint(null);
    if (!code) return;
    const loc = all.data?.find((l) => l.code === code);
    if (!loc) return;
    if (exclude.includes(loc.id)) { setHint(`${loc.code} 已經在這筆操作裡選過了。`); return; }
    if (mode === "stocked" && !loc.occupied) { setHint(`${loc.code} 這裡沒有貨，請點有貨的格子。`); return; }
    if (productId && loc.occupied && loc.product?.id !== productId) { setHint(`${loc.code} 放了「${loc.product?.name}」，不能放不同的商品。請選空的或放同一商品的儲位。`); return; }
    if (productId && loc.occupied && loc.capacity !== null && loc.quantity >= loc.capacity) { setHint(`${loc.code} 已滿（${loc.quantity}/${loc.capacity}）。`); return; }
    onChange(loc);
  }

  return (
    <div className="space-y-3">
      <LocationSelect value={value} onChange={(l) => { setHint(null); onChange(l); }} productId={productId} exclude={exclude} stockedOnly={mode === "stocked"} />
      <div className="flex flex-wrap items-center gap-2">
        <span className="muted">或直接點圖上的格子：</span>
        <div className="flex overflow-hidden rounded-[10px] border border-line">
          {warehouses.data?.items.map((w) => (
            <button key={w.id} type="button" onClick={() => setWhId(w.id)} className={`min-h-[44px] px-4 text-[17px] font-medium ${w.id === activeWh ? "bg-brand-dark text-white" : "bg-white hover:bg-brand-soft"}`}>{w.name}</button>
          ))}
        </div>
        {selected && <span className="tag-info">{label}：{selected.code}</span>}
      </div>
      {hint && <Message kind="warn">{hint}</Message>}
      {layout.data && (
        <FloorplanCanvas
          layout={layout.data}
          racks={toDraft(layout.data)}
          editing={false}
          compact
          selectedLocation={selected && selected.warehouseId === layout.data.id ? selected.code : null}
          selectedRackKey={null}
          highlightCodes={highlight}
          highlightLabel="也選了"
          onSelectLocation={pick}
          onSelectRack={() => undefined}
          onRacksChange={() => undefined}
        />
      )}
    </div>
  );
}
