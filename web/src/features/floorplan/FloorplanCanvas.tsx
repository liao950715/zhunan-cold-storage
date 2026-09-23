import { useEffect, useRef, useState } from "react";
import { Group, Layer, Rect, Stage, Text } from "react-konva";
import type Konva from "konva";
import type { DraftRack, WarehouseLayout } from "../../api/types";
import { clampRect } from "./geometry";

export interface CanvasProps {
  layout: WarehouseLayout;
  racks: DraftRack[];
  editing: boolean;
  selectedLocation: string | null;
  selectedRackKey: string | null;
  /** 搜尋結果（只在從查詢定位或平面圖搜尋時有值） */
  highlightCodes: Set<string>;
  highlightLabel?: string;
  compact?: boolean;
  onSelectLocation: (code: string | null) => void;
  onSelectRack: (key: string | null) => void;
  onRacksChange: (racks: DraftRack[]) => void;
}

const HANDLE_H = 28;

/**
 * 儲位配色（依需求指定）：點選中 > 搜尋結果 > 庫存狀態；每格永遠有「已滿／有貨／空位」文字。
 * 「已滿」只在有效容量已知時判斷；未設定容量不推測。
 */
export const CELL_COLORS = {
  selected: { fill: "#5a8199", stroke: "#29485c", text: "#ffffff", label: "✓ 已選這裡" },
  search: { fill: "#ffe066", stroke: "#111111", text: "#111111", label: "搜尋結果" },
  full: { fill: "#a4262c", stroke: "#7a1c21", text: "#ffffff", label: "已滿" },
  occupied: { fill: "#d9eaf7", stroke: "#4a7fb5", text: "#20252b", label: "有貨" },
  empty: { fill: "#ffffff", stroke: "#9aa3ad", text: "#20252b", label: "空位" },
};
const C = { floor: "#f5f6f8", wall: "#9aa3ad", aisle: "#eceef1", entrance: "#e8effc", rack: "#e6e9ee", rackEdit: "#e8effc", rackStroke: "#9aa3ad", ink: "#20252b", ink2: "#525c69" };

export function cellState(loc: { occupied?: boolean; quantity?: number; capacity?: number | null }) {
  const cap = loc.capacity ?? null;
  const full = !!loc.occupied && cap !== null && (loc.quantity ?? 0) >= cap;
  return full ? "full" : loc.occupied ? "occupied" : "empty";
}

export default function FloorplanCanvas(p: CanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const fit = () => setScale(Math.max(0.2, Math.min(1.6, (el.clientWidth - 2) / p.layout.width)));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [p.layout.width]);

  const W = p.layout.width;
  const H = p.layout.height;
  const fs = (n: number) => (p.compact ? Math.round(n * 0.82) : n);

  function moveRack(key: string, x: number, y: number) {
    p.onRacksChange(p.racks.map((r) => (r.key === key ? { ...r, ...clampRect({ x, y, width: r.width, height: r.height }, W, H) } : r)));
  }
  function moveLocation(rackKey: string, code: string, x: number, y: number) {
    p.onRacksChange(p.racks.map((r) => (r.key !== rackKey ? r : { ...r, locations: r.locations.map((l) => (l.code === code ? { ...l, ...clampRect({ x, y, width: l.width, height: l.height }, r.width, r.height) } : l)) })));
  }
  const clearSel = () => { p.onSelectLocation(null); p.onSelectRack(null); };

  return (
    <div ref={containerRef} className={`w-full overflow-hidden rounded-[14px] bg-white touch-none ${p.editing ? "border-2 border-dashed border-brand" : "border border-line"}`}>
      <Stage width={W * scale} height={H * scale} scaleX={scale} scaleY={scale}
        onClick={(e) => { if (e.target === e.target.getStage()) clearSel(); }}
        onTap={(e) => { if (e.target === e.target.getStage()) clearSel(); }}>
        <Layer>
          <Rect x={0} y={0} width={W} height={H} fill={C.floor} stroke={C.wall} strokeWidth={6} />
          {p.layout.layout.aisles?.map((a, i) => (
            <Group key={i} {...a}>
              <Rect width={a.width} height={a.height} fill={C.aisle} />
              <Text text="通道" fontSize={22} fill={C.ink2} width={a.width} height={a.height} align="center" verticalAlign="middle" />
            </Group>
          ))}
          {p.layout.layout.entrance && (
            <Group {...p.layout.layout.entrance}>
              <Rect width={p.layout.layout.entrance.width} height={p.layout.layout.entrance.height} fill={C.entrance} stroke={C.wall} strokeWidth={1} />
              <Text text="入口" fontSize={22} fill={C.ink} width={p.layout.layout.entrance.width} height={p.layout.layout.entrance.height} align="center" verticalAlign="middle" />
            </Group>
          )}
        </Layer>
        <Layer>
          {p.racks.map((rack) => {
            const rackSelected = p.selectedRackKey === rack.key;
            const select = (e: Konva.KonvaEventObject<Event>) => { if (p.editing) { e.cancelBubble = true; p.onSelectRack(rack.key); p.onSelectLocation(null); } };
            return (
              <Group key={rack.key} x={rack.x} y={rack.y} draggable={p.editing} onDragEnd={(e) => moveRack(rack.key, e.target.x(), e.target.y())} onClick={select} onTap={select}>
                <Rect width={rack.width} height={rack.height} fill={p.editing ? C.rackEdit : C.rack} stroke={rackSelected ? CELL_COLORS.selected.stroke : C.rackStroke} strokeWidth={rackSelected ? 4 : 2} cornerRadius={6} />
                <Rect y={-HANDLE_H} width={rack.width} height={HANDLE_H} fill={p.editing ? (rackSelected ? CELL_COLORS.selected.fill : "#175cd3") : "transparent"} cornerRadius={[6, 6, 0, 0]} />
                <Text text={p.editing ? `⠿ ${rack.label ?? `貨架 ${rack.code}`}（拖曳這一列移動貨架）` : (rack.label ?? `貨架 ${rack.code}`)} x={6} y={-HANDLE_H + 4} fontSize={20} fill={p.editing ? "#ffffff" : C.ink} />
                {rack.locations.map((loc) => {
                  const selected = p.selectedLocation === loc.code;
                  const hl = !selected && p.highlightCodes.has(loc.code);
                  const base = CELL_COLORS[cellState(loc)];
                  const skin = selected ? CELL_COLORS.selected : hl ? CELL_COLORS.search : base;
                  const badge = selected ? CELL_COLORS.selected.label : hl ? (p.highlightLabel ?? CELL_COLORS.search.label) : null;
                  const pick = (e: Konva.KonvaEventObject<Event>) => { e.cancelBubble = true; p.onSelectLocation(loc.code); p.onSelectRack(p.editing ? rack.key : null); };
                  const statusSize = fs(19);
                  return (
                    <Group key={loc.code} x={loc.x} y={loc.y} draggable={p.editing}
                      onDragStart={(e) => { e.cancelBubble = true; }}
                      onDragEnd={(e) => { e.cancelBubble = true; moveLocation(rack.key, loc.code, e.target.x(), e.target.y()); }}
                      onClick={pick} onTap={pick}>
                      <Rect width={loc.width} height={loc.height} fill={skin.fill} stroke={skin.stroke} strokeWidth={selected || hl ? 5 : 2} cornerRadius={4} />
                      {/* 1 儲位編號 */}
                      <Text text={loc.code} x={8} y={6} fontSize={fs(22)} fontStyle="bold" fill={skin.text} />
                      {/* 2 商品與數量 */}
                      {loc.occupied && loc.product && (
                        <Text text={`${loc.product.name}｜${loc.quantity} ${loc.product.unit}`} x={8} y={loc.height / 2 - fs(12)} fontSize={fs(22)} fontStyle="bold" fill={skin.text} width={loc.width - 16} ellipsis wrap="none" />
                      )}
                      {/* 3 庫存狀態（永遠顯示）＋ 右下角「已選／搜尋結果」 */}
                      <Text text={base.label} x={8} y={loc.height - statusSize - 8} fontSize={statusSize} fontStyle="bold" fill={skin.text} />
                      {badge && (
                        <Text text={badge} x={8} y={loc.height - statusSize - 8} width={loc.width - 16} align="right" fontSize={statusSize} fontStyle="bold" fill={skin.text} />
                      )}
                    </Group>
                  );
                })}
              </Group>
            );
          })}
        </Layer>
      </Stage>
    </div>
  );
}
