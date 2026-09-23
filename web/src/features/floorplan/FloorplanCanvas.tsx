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

const COLORS = {
  floor: "#f8fafc",
  wall: "#94a3b8",
  aisle: "#e2e8f0",
  entrance: "#fde68a",
  rack: "#cbd5e1",
  rackEdit: "#bfdbfe",
  empty: "#ffffff",
  occupied: "#bbf7d0",
  selected: "#0284c7",
  highlight: "#f97316",
};

/** React Konva 畫布：檢視模式點選儲位；編輯模式拖曳貨架與儲位（幾何變更只存於 draft，儲存才送後端）。 */
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
    p.onRacksChange(
      p.racks.map((r) =>
        r.key !== rackKey ? r : { ...r, locations: r.locations.map((l) => (l.code === code ? { ...l, ...clampRect({ x, y, width: l.width, height: l.height }, r.width, r.height) } : l)) },
      ),
    );
  }

  return (
    <div ref={containerRef} className="w-full overflow-hidden rounded border border-slate-300 bg-white touch-none">
      <Stage
        width={W * scale}
        height={H * scale}
        scaleX={scale}
        scaleY={scale}
        onClick={(e) => {
          if (e.target === e.target.getStage()) {
            p.onSelectLocation(null);
            p.onSelectRack(null);
          }
        }}
        onTap={(e) => {
          if (e.target === e.target.getStage()) {
            p.onSelectLocation(null);
            p.onSelectRack(null);
          }
        }}
      >
        <Layer>
          <Rect x={0} y={0} width={W} height={H} fill={COLORS.floor} stroke={COLORS.wall} strokeWidth={6} />
          {p.layout.layout.aisles?.map((a, i) => <Rect key={i} {...a} fill={COLORS.aisle} />)}
          {p.layout.layout.entrance && (
            <Group {...p.layout.layout.entrance}>
              <Rect width={p.layout.layout.entrance.width} height={p.layout.layout.entrance.height} fill={COLORS.entrance} />
              <Text text="入口" fontSize={16} width={p.layout.layout.entrance.width} height={p.layout.layout.entrance.height} align="center" verticalAlign="middle" />
            </Group>
          )}
        </Layer>
        <Layer>
          {p.racks.map((rack) => {
            const rackSelected = p.selectedRackKey === rack.key;
            return (
              <Group
                key={rack.key}
                x={rack.x}
                y={rack.y}
                draggable={p.editing}
                onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => moveRack(rack.key, e.target.x(), e.target.y())}
                onClick={(e) => {
                  if (p.editing) {
                    e.cancelBubble = true;
                    p.onSelectRack(rack.key);
                    p.onSelectLocation(null);
                  }
                }}
                onTap={(e) => {
                  if (p.editing) {
                    e.cancelBubble = true;
                    p.onSelectRack(rack.key);
                    p.onSelectLocation(null);
                  }
                }}
              >
                <Rect width={rack.width} height={rack.height} fill={p.editing ? COLORS.rackEdit : COLORS.rack} stroke={rackSelected ? COLORS.selected : "#64748b"} strokeWidth={rackSelected ? 4 : 2} cornerRadius={4} />
                {/* 標題列：編輯模式下作為整座貨架的拖曳把手（儲位鋪滿貨架時仍有地方可抓） */}
                <Rect y={-HANDLE_H} width={rack.width} height={HANDLE_H} fill={p.editing ? (rackSelected ? COLORS.selected : "#60a5fa") : "transparent"} cornerRadius={[4, 4, 0, 0]} />
                <Text
                  text={p.editing ? `⠿ ${rack.label ?? `貨架 ${rack.code}`}（拖曳此列移動貨架）` : (rack.label ?? `貨架 ${rack.code}`)}
                  x={6}
                  y={-HANDLE_H + 4}
                  fontSize={14}
                  fill={p.editing ? "#ffffff" : "#334155"}
                />
                {rack.locations.map((loc) => {
                  const selected = p.selectedLocation === loc.code;
                  const hl = p.highlightCodes.has(loc.code);
                  return (
                    <Group
                      key={loc.code}
                      x={loc.x}
                      y={loc.y}
                      draggable={p.editing}
                      onDragStart={(e) => {
                        e.cancelBubble = true;
                      }}
                      onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => {
                        e.cancelBubble = true;
                        moveLocation(rack.key, loc.code, e.target.x(), e.target.y());
                      }}
                      onClick={(e) => {
                        e.cancelBubble = true;
                        p.onSelectLocation(loc.code);
                        p.onSelectRack(p.editing ? rack.key : null);
                      }}
                      onTap={(e) => {
                        e.cancelBubble = true;
                        p.onSelectLocation(loc.code);
                        p.onSelectRack(p.editing ? rack.key : null);
                      }}
                    >
                      <Rect
                        width={loc.width}
                        height={loc.height}
                        fill={hl ? "#fed7aa" : loc.occupied ? COLORS.occupied : COLORS.empty}
                        stroke={selected ? COLORS.selected : hl ? COLORS.highlight : "#94a3b8"}
                        strokeWidth={selected || hl ? 4 : 1}
                        cornerRadius={3}
                      />
                      <Text text={loc.code} x={4} y={4} fontSize={13} fontStyle="bold" fill="#0f172a" />
                      {loc.occupied && loc.product && (
                        <Text text={`${loc.product.name}\n${loc.quantity} ${loc.product.unit}`} x={4} y={loc.height / 2 - 4} fontSize={13} fill="#14532d" width={loc.width - 8} />
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
