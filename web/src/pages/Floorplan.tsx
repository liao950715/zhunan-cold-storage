import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { del, errorMessage, get, put } from "../api/client";
import type { DraftRack, WarehouseLayout, WarehouseSummary } from "../api/types";
import FloorplanCanvas, { CELL_COLORS } from "../features/floorplan/FloorplanCanvas";
import LocationSelect from "../components/LocationSelect";
import LocationPanel from "../features/floorplan/LocationPanel";
import { useDialog } from "../components/ConfirmDialog";
import { Field, Message, PageTitle } from "../components/ui";
import { defaultLocations, findRackOverlaps, nextLocationCode, nextRackCode, toDraft, toPayload } from "../features/floorplan/geometry";

/**
 * 冷凍庫平面圖：一般模式（點儲位看內容、不可拖曳）／配置編輯模式（獨立狀態、有提示列）。
 * 布局編輯只改幾何，庫存操作走各自 API（FR-005）。支援 ?warehouse=A&highlight=A-01-01,A-01-02。
 */
export default function Floorplan() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const dialog = useDialog();
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

  useEffect(() => { if (layout.data) setDraft(toDraft(layout.data)); }, [layout.data]);

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
      await qc.invalidateQueries({ queryKey: ["allLocations"] });
      setMessage({ kind: "ok", text: "倉庫配置已儲存" });
      setEditing(false);
    },
    onError: (e) => setMessage({ kind: "error", text: errorMessage(e) }),
  });
  const remove = useMutation({
    mutationFn: (t: { kind: "rack" | "location"; id: number }) => del(`/${t.kind === "rack" ? "racks" : "locations"}/${t.id}`),
    onSuccess: async (_d, t) => {
      await qc.invalidateQueries({ queryKey: ["layout", wh!.id] });
      setMessage({ kind: "ok", text: t.kind === "rack" ? "貨架已刪除" : "儲位已刪除" });
      setSelectedLocation(null);
      setSelectedRackKey(null);
    },
    onError: (e) => setMessage({ kind: "error", text: errorMessage(e) }),
  });

  function startEdit() { if (layout.data) setDraft(toDraft(layout.data)); setEditing(true); setMessage(null); setSelectedLocation(null); }
  function cancelEdit() { setEditing(false); setSelectedRackKey(null); setSelectedLocation(null); if (layout.data) setDraft(toDraft(layout.data)); }
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
    setDraft(draft.map((r) => (r.key !== selectedRack.key ? r : { ...r, locations: [...r.locations, { code, x: 0, y: 0, width: Math.min(160, r.width), height: Math.min(100, r.height), defaultCapacity: 20 }] })));
    setSelectedLocation(code);
  }
  async function removeSelected() {
    if (selectedLocation && selectedRack) {
      const loc = selectedRack.locations.find((l) => l.code === selectedLocation);
      if (!loc) return;
      if (loc.id === undefined) { setDraft(draft.map((r) => (r.key !== selectedRack.key ? r : { ...r, locations: r.locations.filter((l) => l.code !== selectedLocation) }))); setSelectedLocation(null); }
      else if (await dialog.confirm("刪除儲位", `確定刪除儲位 ${loc.code}？\n有庫存的儲位會被拒絕。`)) remove.mutate({ kind: "location", id: loc.id });
      return;
    }
    if (selectedRack) {
      if (selectedRack.id === undefined) { setDraft(draft.filter((r) => r.key !== selectedRack.key)); setSelectedRackKey(null); }
      else if (await dialog.confirm("刪除貨架", `確定刪除貨架 ${selectedRack.code} 及其所有儲位？\n任一儲位有庫存會被拒絕。`)) remove.mutate({ kind: "rack", id: selectedRack.id });
    }
  }
  const patchLoc = (patch: { code?: string; defaultCapacity?: number | null; width?: number; height?: number }) => {
    if (!selectedRack || !selectedLocation) return;
    setDraft(draft.map((r) => (r.key !== selectedRack.key ? r : { ...r, locations: r.locations.map((l) => (l.code === selectedLocation ? { ...l, ...patch } : l)) })));
    if (patch.code) setSelectedLocation(patch.code);
  };
  const patchRack = (patch: Partial<Pick<DraftRack, "label" | "width" | "height">>) => { if (selectedRack) setDraft(draft.map((r) => (r.key !== selectedRack.key ? r : { ...r, ...patch }))); };

  if (warehouses.isLoading || !wh) return <p className="text-ink-2">載入中…</p>;

  return (
    <div className="space-y-4">
      <PageTitle sub={editing ? "配置編輯模式" : "點一下儲位，就能看到裡面放什麼"}>冷凍庫平面圖</PageTitle>

      {editing && (
        <div className="flex flex-wrap items-center gap-3 rounded-[10px] border-l-4 border-brand bg-brand-soft px-4 py-3 text-[18px]">
          <span><b>正在調整貨架配置</b> — 拖曳貨架把手或儲位可移動；完成請按「儲存倉庫配置」。這裡的變更不會影響任何庫存。</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex overflow-hidden rounded-[10px] border border-line">
          {warehouses.data!.items.map((w) => (
            <button key={w.id} disabled={editing} onClick={() => { setParams({ warehouse: w.code }); setSelectedLocation(null); }}
              className={`min-h-[52px] px-5 text-[18px] font-medium ${w.code === wh.code ? "bg-brand-dark text-white" : "bg-white hover:bg-brand-soft"} disabled:opacity-50`}>
              {w.name}
            </button>
          ))}
        </div>
        <span className="muted">{wh.rackCount} 座貨架 · {wh.locationCount} 個儲位</span>
        {highlightCodes.size > 0 && !editing && (
          <button className="btn-sm" onClick={() => setParams({ warehouse: wh.code })}>清除搜尋標示（{highlightCodes.size} 個）</button>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          {!editing ? (
            <button className="btn-sm" onClick={startEdit}>調整貨架配置（管理用）</button>
          ) : (
            <>
              <button className="btn" onClick={addRack}>＋ 新增貨架</button>
              <button className="btn" onClick={addLocation} disabled={!selectedRack}>＋ 新增儲位</button>
              <button className="btn text-bad" onClick={removeSelected} disabled={!selectedRack && !selectedLocation}>刪除所選</button>
              <button className="btn" onClick={cancelEdit}>取消</button>
              <button className="btn-primary" onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? "儲存中…" : "儲存倉庫配置"}</button>
            </>
          )}
        </div>
      </div>

      {message && <Message kind={message.kind}>{message.text}</Message>}
      {editing && overlapsList.length > 0 && <Message kind="warn">貨架 {overlapsList.map(([a, b]) => `${a}／${b}`).join("、")} 互相重疊（仍可儲存）</Message>}

      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <div className="space-y-2">
          {layout.data ? (
            <FloorplanCanvas layout={layout.data} racks={racks} editing={editing} selectedLocation={selectedLocation} selectedRackKey={selectedRackKey} highlightCodes={highlightCodes} onSelectLocation={setSelectedLocation} onSelectRack={setSelectedRackKey} onRacksChange={setDraft} />
          ) : (
            <p className="text-ink-2">載入平面圖…</p>
          )}
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-[16px] text-ink" aria-label="圖例">
            {([["empty", "空位"], ["occupied", "有貨"], ["full", "已滿（依設定的容量）"], ["selected", "點選中"]] as const).map(([k, label]) => (
              <span key={k} className="flex items-center gap-2"><i className="inline-block h-5 w-8 rounded border-2" style={{ background: CELL_COLORS[k].fill, borderColor: CELL_COLORS[k].stroke }} />{label}</span>
            ))}
            {highlightCodes.size > 0 && <span className="flex items-center gap-2"><i className="inline-block h-5 w-8 rounded border-2" style={{ background: CELL_COLORS.search.fill, borderColor: CELL_COLORS.search.stroke }} />搜尋結果</span>}
          </div>
        </div>
        <aside className="panel min-h-40">
          {!editing && selectedLoc && (
            <LocationPanel locationId={selectedLoc.id} onAction={(action, d) => {
              const first = d.lines[0];
              if (action === "inbound") navigate(`/inbound?locationId=${d.location.id}`);
              if (action === "outbound") navigate(`/outbound?productId=${d.currentProduct!.id}&locationId=${d.location.id}${first ? `&batchId=${first.batch.id}` : ""}`);
              if (action === "transfer") navigate(`/transfer?locationId=${d.location.id}${first ? `&batchId=${first.batch.id}` : ""}`);
            }} />
          )}
          {!editing && !selectedLoc && (
            <div className="space-y-3">
              <p className="text-[18px] text-ink-2">點一下儲位，就能看到裡面放什麼，並可直接入庫、出庫或搬移。</p>
              {highlightCodes.size > 0 && <p className="text-[18px]"><span className="rounded px-2 py-0.5 font-bold" style={{ background: CELL_COLORS.search.fill }}>搜尋結果</span> {[...highlightCodes].join("、")}</p>}
              <label className="block"><span className="label">或用鍵盤選儲位</span>
                <LocationSelect value={null} onChange={(l) => { if (l) { if (l.warehouseCode !== wh.code) setParams({ warehouse: l.warehouseCode, ...(params.get("highlight") ? { highlight: params.get("highlight")! } : {}) }); setSelectedLocation(l.code); } }} />
              </label>
            </div>
          )}
          {editing && selectedRack && !selectedLocation && (
            <div className="space-y-3">
              <h3 className="text-[22px] font-bold">貨架 {selectedRack.code}</h3>
              <Field label="名稱"><input className="input" value={selectedRack.label ?? ""} onChange={(e) => patchRack({ label: e.target.value })} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="寬"><input type="number" className="input" value={selectedRack.width} min={40} onChange={(e) => patchRack({ width: Number(e.target.value) })} /></Field>
                <Field label="高"><input type="number" className="input" value={selectedRack.height} min={40} onChange={(e) => patchRack({ height: Number(e.target.value) })} /></Field>
              </div>
              <p className="muted">{selectedRack.locations.length} 個儲位；點選儲位可編輯</p>
            </div>
          )}
          {editing && selectedRack && selectedLocation && (() => {
            const loc = selectedRack.locations.find((l) => l.code === selectedLocation);
            if (!loc) return null;
            return (
              <div className="space-y-3">
                <h3 className="text-[22px] font-bold">儲位 {loc.code}</h3>
                <Field label="儲位編號" hint={loc.id !== undefined ? "既有儲位的編號不可修改（歷史紀錄用它追溯）" : undefined}><input className="input" value={loc.code} disabled={loc.id !== undefined} onChange={(e) => patchLoc({ code: e.target.value.trim() })} /></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="寬"><input type="number" className="input" value={loc.width} min={20} onChange={(e) => patchLoc({ width: Number(e.target.value) })} /></Field>
                  <Field label="高"><input type="number" className="input" value={loc.height} min={20} onChange={(e) => patchLoc({ height: Number(e.target.value) })} /></Field>
                </div>
                <Field label="預設容量（空白＝不限制）"><input type="number" className="input" value={loc.defaultCapacity ?? ""} min={1} onChange={(e) => patchLoc({ defaultCapacity: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
                {loc.occupied && <p className="tag-ok inline-block">有貨：{loc.product?.name} {loc.quantity} {loc.product?.unit}（不可刪除）</p>}
              </div>
            );
          })()}
          {editing && !selectedRack && <p className="text-[18px] text-ink-2">點選貨架或儲位進行編輯，或按「＋ 新增貨架」。</p>}
        </aside>
      </div>
    </div>
  );
}
