import type { DraftRack } from "../../api/types";
import { CELL_COLORS, cellState } from "./FloorplanCanvas";

interface Props {
  racks: DraftRack[];
  selectedLocation: string | null;
  highlightCodes: Set<string>;
  highlightLabel?: string;
  marks?: Record<string, { label: string; kind: "from" | "to" }>;
  onSelectLocation: (code: string | null) => void;
}

/**
 * 平面圖的「大字列表」版：手機預設用這個。
 * 每一列就是一個儲位按鈕（可用鍵盤聚焦），顏色與圖上同一套，並且永遠附文字（有貨／已滿／空位／已選／搜尋結果）。
 */
export default function LocationList(p: Props) {
  return (
    <div className="space-y-4" role="list" aria-label="儲位列表">
      {p.racks.map((rack) => (
        <section key={rack.key}>
          <h3 className="mb-2 text-[18px] font-bold text-ink-2">{rack.label ?? `貨架 ${rack.code}`}</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {rack.locations.map((loc) => {
              const mark = p.marks?.[loc.code];
              const selected = !mark && p.selectedLocation === loc.code;
              const hl = !mark && !selected && p.highlightCodes.has(loc.code);
              const base = CELL_COLORS[cellState(loc)];
              const skin = mark ? CELL_COLORS[mark.kind] : selected ? CELL_COLORS.selected : hl ? CELL_COLORS.search : base;
              const tag = mark ? mark.label : selected ? CELL_COLORS.selected.label : hl ? (p.highlightLabel ?? CELL_COLORS.search.label) : null;
              return (
                <button
                  key={loc.code}
                  type="button"
                  role="listitem"
                  aria-pressed={!!mark || selected}
                  onClick={() => p.onSelectLocation(loc.code)}
                  className="flex min-h-[64px] w-full items-center gap-3 rounded-[12px] border-[3px] px-3 py-2 text-left focus:outline-none focus-visible:ring-4 focus-visible:ring-brand/50"
                  style={{ background: skin.fill, borderColor: skin.stroke, color: skin.text }}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-[20px] font-bold leading-tight">
                      {loc.code}
                      <span className="ml-2 text-[16px] font-bold opacity-90">{base.label}</span>
                    </span>
                    <span className="block truncate text-[18px]">
                      {loc.occupied && loc.product ? `${loc.product.name}｜${loc.quantity} ${loc.product.unit}` : "沒有放東西"}
                      {loc.occupied && loc.capacity != null && <span className="opacity-80">（容量 {loc.capacity}）</span>}
                    </span>
                  </span>
                  {tag && <span className="shrink-0 text-[16px] font-bold">{tag}</span>}
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
