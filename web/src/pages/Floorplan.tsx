import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { del, errorMessage, get, put } from "../api/client";
import type { DraftRack, WarehouseLayout, WarehouseSummary } from "../api/types";
import FloorplanCanvas from "../features/floorplan/FloorplanCanvas";
import LocationPanel from "../features/floorplan/LocationPanel";
import { defaultLocations, findRackOverlaps, nextLocationCode, nextRackCode, toDraft, toPayload } from "../features/floorplan/geometry";

/**
 * 冷凍庫平面圖：檢視模式（點儲位看內容）／配置編輯模式（新增、拖曳、刪除、儲存）。
 * 布局編輯只改幾何，庫存操作走各自 API（FR-005）。
 * 支援 ?warehouse=A&highlight=A-01-01,A-01-02 供搜尋定位（Stage 4）。
 */
export default function Floorplan() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const warehouses = useQuery({ queryKey: ["warehouses"], queryFn: () => get<{ items: WarehouseSummary[] }>("/warehouses") });
  const whCode = params.get("warehouse") ?? warehouses.data?.items[0]?.code ?? null;
  const wh = warehouses.data?.items.find((w) => w.code === whCode) ?? null;
  const layout = useQuery({ queryKey: ["layout", wh?.id], queryFn: () => get<WarehouseLayout>(`/warehouses/${wh!.id}/layout`), enabled: !!wh });

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<DraftRack[]>([]);
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);
  const [selectedRackKey, setSelectedRackKey] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const highlightCodes = useMemo(() => new Set((params.get("highlight") ?? "").split(",").filter(Boolean)), [params]);

  // 進入／離開編輯模式或重新載入時，以伺服器資料重建草稿
  useEffect(() => {
    if (layout.data) setDraft(toDraft(layout.data));
  }, [layout.data]);

  const racks = editing ? draft : layout.data ? toDraft(layout.data) : [];
  const allCodes = useMemo(() => new Set(racks.flatMap((r) => r.locations.map((l) => l.code))), [racks]);
  const overlapsList = editing ? findRackOverlaps(draft) : [];
  const selectedRack = draft.find((r) => r.key === selectedRackKey) ?? null;
  const selectedLoc = layout.data?.racks.flatMap((r) => r.locations).find((l) => l.code === selectedLocation) ?? null;

  const save = useMutation({
    mutationFn: () => put<{ layoutVersion: number }>(`/warehouses/${wh!.id}/layout`, toPayload(layout.data!.layoutVersion, draft)),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["layout", wh!.id] });
      await qc.invalidateQueries({ queryKey: ["warehouses"] });
      setMessage({ kind: "ok", text: "布局已儲存" });
      setEditing(false);
    },
    onError: (e) => setMessage({ kind: "error", text: errorMessage(e) }),
  });

  const remove = useMutation({
    mutationFn: (target: { kind: "rack" | "location"; id: number }) => del(`/${target.kind === "rack" ? "racks" : "locations"}/${target.id}`),
    onSuccess: async (_d, target) => {
      await qc.invalidateQueries({ queryKey: ["layout", wh!.id] });
      setMessage({ kind: "ok", text: target.kind === "rack" ? "貨架已刪除" : "儲位已刪除" });
      setSelectedLocation(null);
      setSelectedRackKey(null);
    },
    onError: (e) => setMessage({ kind: "error", text: errorMessage(e) }),
  });

  function startEdit() {
    if (layout.data) setDraft(toDraft(layout.data));
    setEditing(true);
    setMessage(null);
    setSelectedLocation(null);
  }
  function cancelEdit() {
    setEditing(false);
    setSelectedRackKey(null);
    setSelectedLocation(null);
    if (layout.data) setDraft(toDraft(layout.data));
  }
  function addRack() {
    if (!layout.data) return;
    const code = nextRackCode(draft);
    const rack: DraftRack = { key: `new-${Date.now()}`, code, label: `貨架 ${code}`, x: 40, y: 40, width: 480, height: 200, locations: [] };
    rack.locations = defaultLocations(layout.data.code, rack, allCodes);
    setDraft([...draft, rack]);
    setSelectedRackKey(rack.key);
  }
  function addLocation() {
    if (!layout.data || !selectedRack) return;
    const code = nextLocationCode(layout.data.code, selectedRack, allCodes);
    const w = Math.min(160, selectedRack.width);
    const h = Math.min(100, selectedRack.height);
    setDraft(draft.map((r) => (r.key !== selectedRack.key ? r : { ...r, locations: [...r.locations, { code, x: 0, y: 0, width: w, height: h, defaultCapacity: 20 }] })));
    setSelectedLocation(code);
  }
  function removeSelected() {
    if (selectedLocation && selectedRack) {
      const loc = selectedRack.locations.find((l) => l.code === selectedLocation);
      if (!loc) return;
      if (loc.id === undefined) {
        setDraft(draft.map((r) => (r.key !== selectedRack.key ? r : { ...r, locations: r.locations.filter((l) => l.code !== selectedLocation) })));
        setSelectedLocation(null);
      } else if (confirm(`確定刪除儲位 ${loc.code}？（有庫存會被拒絕）`)) {
        remove.mutate({ kind: "location", id: loc.id });
      }
      return;
    }
    if (selectedRack) {
      if (selectedRack.id === undefined) {
        setDraft(draft.filter((r) => r.key !== selectedRack.key));
        setSelectedRackKey(null);
      } else if (confirm(`確定刪除貨架 ${selectedRack.code} 及其所有儲位？（任一儲位有庫存會被拒絕）`)) {
        remove.mutate({ kind: "rack", id: selectedRack.id });
      }
    }
  }
  function updateSelectedLocation(patch: { code?: string; defaultCapacity?: number | null; width?: number; height?: number }) {
    if (!selectedRack || !selectedLocation) return;
    setDraft(draft.map((r) => (r.key !== selectedRack.key ? r : { ...r, locations: r.locations.map((l) => (l.code === selectedLocation ? { ...l, ...patch } : l)) })));
    if (patch.code) setSelectedLocation(patch.code);
  }
  function updateSelectedRack(patch: Partial<Pick<DraftRack, "label" | "width" | "height">>) {
    if (!selectedRack) return;
    setDraft(draft.map((r) => (r.key !== selectedRack.key ? r : { ...r, ...patch })));
  }

  if (warehouses.isLoading || !wh) return <p className="text-slate-500">載入中…</p>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded border border-slate-300 overflow-hidden">
          {warehouses.data!.items.map((w) => (
            <button
              key={w.id}
              disabled={editing}
              onClick={() => {
                setParams({ warehouse: w.code });
                setSelectedLocation(null);
              }}
              className={`px-3 py-1.5 text-sm ${w.code === wh.code ? "bg-sky-600 text-white" : "bg-white hover:bg-slate-50"} disabled:opacity-50`}
            >
              {w.name}
            </button>
          ))}
        </div>
        <span className="text-xs text-slate-500">
          {wh.rackCount} 座貨架 · {wh.locationCount} 個儲位
        </span>
        <div className="ml-auto flex gap-2">
          {!editing ? (
            <button className="btn-primary" onClick={startEdit}>編輯配置</button>
          ) : (
            <>
              <button className="btn" onClick={addRack}>＋ 貨架</button>
              <button className="btn" onClick={addLocation} disabled={!selectedRack}>＋ 儲位</button>
              <button className="btn text-red-700" onClick={removeSelected} disabled={!selectedRack && !selectedLocation}>刪除</button>
              <button className="btn" onClick={cancelEdit}>取消</button>
              <button className="btn-primary" onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? "儲存中…" : "儲存布局"}</button>
            </>
          )}
        </div>
      </div>

      {message && (
        <p role="status" className={`rounded px-3 py-2 text-sm ${message.kind === "ok" ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`}>{message.text}</p>
      )}
      {editing && overlapsList.length > 0 && (
        <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">注意：貨架 {overlapsList.map(([a, b]) => `${a}／${b}`).join("、")} 互相重疊（仍可儲存）</p>
      )}
      {editing && <p className="text-xs text-slate-500">編輯模式：拖曳貨架或儲位調整位置；點選後可改名稱、尺寸與預設容量。布局變更不影響任何庫存。</p>}

      <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
        {layout.data ? (
          <FloorplanCanvas
            layout={layout.data}
            racks={racks}
            editing={editing}
            selectedLocation={selectedLocation}
            selectedRackKey={selectedRackKey}
            highlightCodes={highlightCodes}
            onSelectLocation={setSelectedLocation}
            onSelectRack={setSelectedRackKey}
            onRacksChange={setDraft}
          />
        ) : (
          <p className="text-slate-500">載入平面圖…</p>
        )}
        <aside className="rounded border border-slate-200 bg-white p-4 min-h-40">
          {!editing && selectedLoc && <LocationPanel locationId={selectedLoc.id} />}
          {!editing && !selectedLoc && <p className="text-sm text-slate-500">點選儲位查看內容。綠色＝有庫存，白色＝空儲位{highlightCodes.size > 0 && "，橘色＝搜尋結果"}。</p>}
          {editing && selectedRack && !selectedLocation && (
            <div className="space-y-2 text-sm">
              <h3 className="font-bold">貨架 {selectedRack.code}</h3>
              <label className="block">名稱<input className="input" value={selectedRack.label ?? ""} onChange={(e) => updateSelectedRack({ label: e.target.value })} /></label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">寬<input type="number" className="input" value={selectedRack.width} min={40} onChange={(e) => updateSelectedRack({ width: Number(e.target.value) })} /></label>
                <label className="block">高<input type="number" className="input" value={selectedRack.height} min={40} onChange={(e) => updateSelectedRack({ height: Number(e.target.value) })} /></label>
              </div>
              <p className="text-xs text-slate-500">{selectedRack.locations.length} 個儲位；點選儲位可編輯</p>
            </div>
          )}
          {editing && selectedRack && selectedLocation && (() => {
            const loc = selectedRack.locations.find((l) => l.code === selectedLocation);
            if (!loc) return null;
            return (
              <div className="space-y-2 text-sm">
                <h3 className="font-bold">儲位 {loc.code}</h3>
                <label className="block">代碼<input className="input" value={loc.code} disabled={loc.id !== undefined} onChange={(e) => updateSelectedLocation({ code: e.target.value.trim() })} /></label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">寬<input type="number" className="input" value={loc.width} min={20} onChange={(e) => updateSelectedLocation({ width: Number(e.target.value) })} /></label>
                  <label className="block">高<input type="number" className="input" value={loc.height} min={20} onChange={(e) => updateSelectedLocation({ height: Number(e.target.value) })} /></label>
                </div>
                <label className="block">預設容量（空白＝不限制）
                  <input type="number" className="input" value={loc.defaultCapacity ?? ""} min={1} onChange={(e) => updateSelectedLocation({ defaultCapacity: e.target.value === "" ? null : Number(e.target.value) })} />
                </label>
                {loc.occupied && <p className="text-xs text-green-800">目前存放 {loc.product?.name} {loc.quantity} {loc.product?.unit}（不可刪除）</p>}
              </div>
            );
          })()}
          {editing && !selectedRack && <p className="text-sm text-slate-500">點選貨架或儲位進行編輯，或按「＋ 貨架」新增。</p>}
        </aside>
      </div>
    </div>
  );
}
