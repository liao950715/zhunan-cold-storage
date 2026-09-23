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
  highlightCodes: Set<string>;
  onSelectLocation: (code: string | null) => void;
  onSelectRack: (key: string | null) => void;
  onRacksChange: (racks: DraftRack[]) => void;
}

const HANDLE_H = 22;

/** 配色依 Design System；每格一律有文字（空儲位／商品｜數量／已滿），顏色只是輔助。 */
const C = {
  floor: "#fafaf7", wall: "#9aa8a3", aisle: "#f0f2f1", entrance: "#eeddc7",
  rack: "#e4e9ec", rackEdit: "#e8f0f4", rackStroke: "#9aa8a3",
  empty: "#ffffff", occupied: "#dce8e2", full: "#eeddc7", highlight: "#f6e3c9",
  selected: "#5a8199", highlightStroke: "#c9843a", ink: "#303735", ink2: "#626b68", ok: "#2f5d46", warn: "#7a4b1e",
};

export default function FloorplanCanvas(p: CanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const fit = () => setScale(Math.max(0.2, Math.min(1, (el.clientWidth - 2) / p.layout.width)));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [p.layout.width]);

  const W = p.layout.width;
  const H = p.layout.height;

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
              <Text text="通道" fontSize={16} fill={C.ink2} width={a.width} height={a.height} align="center" verticalAlign="middle" />
            </Group>
          ))}
          {p.layout.layout.entrance && (
            <Group {...p.layout.layout.entrance}>
              <Rect width={p.layout.layout.entrance.width} height={p.layout.layout.entrance.height} fill={C.entrance} />
              <Text text="入口" fontSize={16} fill={C.ink} width={p.layout.layout.entrance.width} height={p.layout.layout.entrance.height} align="center" verticalAlign="middle" />
            </Group>
          )}
        </Layer>
        <Layer>
          {p.racks.map((rack) => {
            const rackSelected = p.selectedRackKey === rack.key;
            const select = (e: Konva.KonvaEventObject<Event>) => { if (p.editing) { e.cancelBubble = true; p.onSelectRack(rack.key); p.onSelectLocation(null); } };
            return (
              <Group key={rack.key} x={rack.x} y={rack.y} draggable={p.editing} onDragEnd={(e) => moveRack(rack.key, e.target.x(), e.target.y())} onClick={select} onTap={select}>
                <Rect width={rack.width} height={rack.height} fill={p.editing ? C.rackEdit : C.rack} stroke={rackSelected ? C.selected : C.rackStroke} strokeWidth={rackSelected ? 4 : 2} cornerRadius={6} />
                {/* 標題列：編輯模式下作為整座貨架的拖曳把手 */}
                <Rect y={-HANDLE_H} width={rack.width} height={HANDLE_H} fill={p.editing ? (rackSelected ? C.selected : "#7297ac") : "transparent"} cornerRadius={[6, 6, 0, 0]} />
                <Text text={p.editing ? `⠿ ${rack.label ?? `貨架 ${rack.code}`}（拖曳這一列移動貨架）` : (rack.label ?? `貨架 ${rack.code}`)} x={6} y={-HANDLE_H + 4} fontSize={14} fill={p.editing ? "#ffffff" : C.ink} />
                {rack.locations.map((loc) => {
                  const selected = p.selectedLocation === loc.code;
                  const hl = p.highlightCodes.has(loc.code);
                  const cap = loc.defaultCapacity;
                  const full = !!loc.occupied && cap !== null && cap !== undefined && (loc.quantity ?? 0) >= cap;
                  const fill = hl ? C.highlight : full ? C.full : loc.occupied ? C.occupied : C.empty;
                  const status = full ? "已滿" : loc.occupied ? "有貨" : "空儲位";
                  const pick = (e: Konva.KonvaEventObject<Event>) => { e.cancelBubble = true; p.onSelectLocation(loc.code); p.onSelectRack(p.editing ? rack.key : null); };
                  return (
                    <Group key={loc.code} x={loc.x} y={loc.y} draggable={p.editing}
                      onDragStart={(e) => { e.cancelBubble = true; }}
                      onDragEnd={(e) => { e.cancelBubble = true; moveLocation(rack.key, loc.code, e.target.x(), e.target.y()); }}
                      onClick={pick} onTap={pick}>
                      <Rect width={loc.width} height={loc.height} fill={fill} stroke={selected ? C.selected : hl ? C.highlightStroke : C.rackStroke} strokeWidth={selected || hl ? 4 : 1} cornerRadius={4} />
                      <Text text={loc.code} x={6} y={5} fontSize={14} fontStyle="bold" fill={C.ink} />
                      <Text text={hl ? "你找的位置" : status} x={6} y={loc.height - 20} fontSize={12} fill={hl ? C.warn : full ? C.warn : loc.occupied ? C.ok : C.ink2} />
                      {loc.occupied && loc.product && (
                        <Text text={`${loc.product.name}｜${loc.quantity} ${loc.product.unit}`} x={6} y={loc.height / 2 - 8} fontSize={14} fontStyle="bold" fill={C.ink} width={loc.width - 12} ellipsis wrap="none" />
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
