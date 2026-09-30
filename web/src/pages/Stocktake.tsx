import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { errorMessage, get, post } from "../api/client";
import { useInvalidateStock, useWarehouses } from "../api/hooks";
import { STOCKTAKE_REASONS, type BaselineItem, type Stocktake as StocktakeT, type StocktakeReasonCode } from "../api/types";
import { todayStr } from "../api/hooks";
import { useAuth } from "../auth/AuthContext";
import { Card, Message, PageTitle, StepBanner, fmtDate, fmtReceived, fmtTime } from "../components/ui";
import { useDialog } from "../components/ConfirmDialog";
import { DamageFlow, type DamageDone, type DamagePreset } from "./Damage";

const STATUS: Record<StocktakeT["status"], string> = { PENDING: "待核准", APPROVED: "已核准", REJECTED: "已退回" };

/** FR-015：工作人員提交盤點（不改庫存）；管理員核准／退回（核准時後端比對基準）。 */
export default function Stocktake() {
  const { user } = useAuth();
  const invalidate = useInvalidateStock();
  const dialog = useDialog();
  const [tab, setTab] = useState<"list" | "new">("list");
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const list = useQuery({ queryKey: ["stocktakes"], queryFn: () => get<{ items: StocktakeT[] }>("/stocktakes") });
  const [open, setOpen] = useState<number | null>(null);

  const review = useMutation({
    mutationFn: ({ id, action, note }: { id: number; action: "approve" | "reject"; note: string }) => post<{ adjustments?: number }>(`/stocktakes/${id}/${action}`, { note: note || null }),
    onSuccess: async (r, v) => {
      setMsg({ kind: "ok", text: v.action === "approve" ? `盤點 #${v.id} 已核准，產生 ${r.adjustments} 筆調整` : `盤點 #${v.id} 已退回` });
      await invalidate();
    },
    onError: (e) => setMsg({ kind: "error", text: errorMessage(e) }),
  });

  return (
    <div className="space-y-3">
      <PageTitle sub="工作人員提交實際清點數量；只有管理員核准後才調整正式庫存">盤點管理</PageTitle>
      {tab === "list" && (() => {
        const pending = list.data?.items.filter((s) => s.status === "PENDING").length ?? 0;
        if (pending === 0) return <StepBanner>目前沒有待核准的盤點；要盤點請按「＋ 新盤點」</StepBanner>;
        return <StepBanner>{user?.role === "ADMIN" ? `有 ${pending} 張待核准，請按「明細」核對差異後核准或退回` : `有 ${pending} 張等待管理員核准，正式庫存尚未變動`}</StepBanner>;
      })()}
      <div className="flex gap-2">
        <button className={tab === "list" ? "btn-primary" : "btn"} onClick={() => setTab("list")}>盤點單</button>
        <button className={tab === "new" ? "btn-primary" : "btn"} onClick={() => setTab("new")}>＋ 新盤點</button>
      </div>
      {msg && <Message kind={msg.kind}>{msg.text}</Message>}
      {tab === "new" && <NewStocktake onDone={async (id) => { await invalidate(); setTab("list"); setMsg({ kind: "ok", text: `盤點單 #${id} 已提交，等待管理員核准；正式庫存尚未變動` }); }} />}
      {tab === "list" && (
        <div className="space-y-3">
          {list.isPending && <p className="text-[18px] text-ink-2">正在讀取盤點單…</p>}
          {list.isError && <Message kind="error">{errorMessage(list.error)} <button type="button" className="btn-sm ml-2" onClick={() => list.refetch()}>重試</button></Message>}
          {list.data?.items.length === 0 && <p className="panel text-[18px] text-ink-2">尚無盤點單</p>}
          {/* 每張盤點單一張卡片：手機不用往右滑就看得到狀態、差異與按鈕 */}
          {list.data?.items.map((s) => {
            const diffCount = s.items.filter((i) => i.diff !== 0).length;
            const canReview = s.status === "PENDING" && user?.role === "ADMIN";
            return (
              <section key={s.id} className={`panel space-y-3 ${s.status === "PENDING" ? "border-l-8 border-warn" : ""}`} aria-label={`盤點單 ${s.id}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[22px] font-bold">盤點 #{s.id}</span>
                  <span className={s.status === "PENDING" ? "tag-warn" : s.status === "APPROVED" ? "tag-ok" : "tag-info"}>{STATUS[s.status]}</span>
                  <span className="text-[18px] text-ink-2">範圍：{s.warehouse?.name ?? "全部冷凍庫"}</span>
                </div>
                <div className="grid gap-1 text-[18px] sm:grid-cols-2">
                  <p>明細 <b>{s.items.length}</b> 筆，<b className={diffCount > 0 ? "text-warn" : ""}>{diffCount === 0 ? "全部相符" : `${diffCount} 筆有差異`}</b></p>
                  <p className="text-ink-2">提交：{s.submittedBy.displayName}・{fmtTime(s.submittedAt)}</p>
                  {s.reviewedBy && <p className="text-ink-2 sm:col-span-2">審核：{s.reviewedBy.displayName}・{fmtTime(s.reviewedAt!)}{s.reviewNote && <>・「{s.reviewNote}」</>}</p>}
                  {s.note && <p className="text-ink-2 sm:col-span-2">備註：{s.note}</p>}
                  {!!s.damages?.length && <p className="sm:col-span-2">盤點中已報損 <b>{s.damages.length}</b> 筆（報損時已扣庫存，核准不會再扣）</p>}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn" aria-expanded={open === s.id} onClick={() => setOpen(open === s.id ? null : s.id)}>{open === s.id ? "收合明細" : "看明細"}</button>
                  {canReview && (
                    <>
                      <button type="button" className="btn-primary" disabled={review.isPending} onClick={async () => { const note = await dialog.prompt(`核准盤點 #${s.id}：備註（可留空）`); if (note !== null) review.mutate({ id: s.id, action: "approve", note }); }}>核准</button>
                      <button type="button" className="btn text-bad" disabled={review.isPending} onClick={async () => { const note = await dialog.prompt(`退回盤點 #${s.id}：原因`); if (note !== null) review.mutate({ id: s.id, action: "reject", note }); }}>退回</button>
                    </>
                  )}
                </div>
                {open === s.id && (
                  <div className="divide-y divide-line rounded-[10px] bg-bg-2 px-3">
                    {s.items.map((i) => (
                      <div key={i.id} className={`flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-[18px] ${i.diff !== 0 ? "font-bold" : ""}`}>
                        <span className="min-w-[110px]">{i.locationCode}</span>
                        <span className="min-w-0 flex-1">{i.product.name}<span className="ml-2 text-[16px] font-normal text-ink-2">批次 {i.batchNo}</span></span>
                        <span className="whitespace-nowrap">系統 {i.systemQty} {i.product.unit} → 實盤 {i.countedQty} {i.product.unit}</span>
                        <span className={`whitespace-nowrap ${i.diff < 0 ? "text-bad" : i.diff > 0 ? "text-ok" : "text-ink-2"}`}>{i.diff === 0 ? "相符" : `差異 ${i.diff > 0 ? "+" : ""}${i.diff} ${i.product.unit}`}</span>
                        {i.diff !== 0 && <span className="basis-full text-[17px] font-normal">原因：<b>{i.reason ?? "（未填）"}</b></span>}
                      </div>
                    ))}
                    {!!s.damages?.length && (
                      <div className="space-y-1 py-2">
                        <p className="text-[18px] font-bold">盤點中已報損（報損時已扣庫存，上面的系統數量已是扣完的數字，核准不會再扣）</p>
                        {s.damages.map((d) => (
                          <p key={d.movementId} className="text-[17px]">{d.locationCode}　{d.product.name} −{d.quantity} {d.product.unit}<span className="ml-2 text-ink-2">批次 {d.batchNo}・{d.reason}・{fmtTime(d.createdAt)}{d.reversalId ? "・已復原" : ""}</span></p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function NewStocktake({ onDone }: { onDone: (id: number) => void }) {
  const warehouses = useWarehouses();
  const dialog = useDialog();
  const [warehouseId, setWarehouseId] = useState<number | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [reasons, setReasons] = useState<Record<string, { code: StocktakeReasonCode | null; note: string }>>({});
  const [note, setNote] = useState("");
  // 盤點中按「建立報損」：damaging＝正在報損的那一格；damages＝本次盤點已完成的報損（提交時附上供核對）
  const [damaging, setDamaging] = useState<DamagePreset | null>(null);
  const [damages, setDamages] = useState<Array<DamageDone & { key: string }>>([]);
  const [info, setInfo] = useState<string | null>(null);
  const baseline = useQuery({ queryKey: ["stocktakeBaseline", warehouseId], queryFn: () => get<{ items: BaselineItem[] }>(`/stocktakes/baseline${warehouseId ? `?warehouseId=${warehouseId}` : ""}`) });
  const key = (b: BaselineItem) => `${b.locationId}:${b.batchId}`;
  const counted = (b: BaselineItem) => counts[key(b)] ?? b.systemQty;
  const reasonOf = (b: BaselineItem) => reasons[key(b)] ?? { code: null, note: "" };
  // 數量與系統不同時才需要原因；選「其他」要寫說明
  const reasonMissing = (b: BaselineItem) => counted(b) !== b.systemQty && (!reasonOf(b).code || (reasonOf(b).code === "OTHER" && !reasonOf(b).note.trim()));
  const setReason = (b: BaselineItem, patch: Partial<{ code: StocktakeReasonCode | null; note: string }>) => setReasons({ ...reasons, [key(b)]: { ...reasonOf(b), ...patch } });
  const today = todayStr();

  const submit = useMutation({
    mutationFn: () => post<{ id: number }>("/stocktakes", { warehouseId: warehouseId ?? undefined, note: note || null, damageMovementIds: damages.map((d) => d.movementId), items: baseline.data!.items.map((b) => {
      const diff = counted(b) !== b.systemQty;
      return { locationId: b.locationId, batchId: b.batchId, countedQty: counted(b), systemQty: b.systemQty, reasonCode: diff ? reasonOf(b).code : null, reasonNote: diff ? reasonOf(b).note.trim() || null : null };
    }) }),
    onSuccess: (r) => onDone(r.id),
  });
  const diffs = baseline.data?.items.filter((b) => counted(b) !== b.systemQty).length ?? 0;
  const missingReasons = baseline.data?.items.filter(reasonMissing).length ?? 0;
  const damagedOf = (b: BaselineItem) => damages.filter((d) => d.key === key(b)).reduce((sum, d) => sum + d.quantity, 0);

  const startDamage = (b: BaselineItem, shortage: number) => {
    setInfo(null);
    setDamaging({ locationId: b.locationId, batchId: b.batchId, quantity: shortage, maxQuantity: shortage, reason: "腐爛" });
    window.scrollTo(0, 0);
  };
  // 報損完成：庫存已扣、基準重新讀取 → 這一格的系統數量變成扣完的數字，差異自動只剩沒報損的部分
  const finishDamage = async (r: DamageDone) => {
    const k = `${damaging!.locationId}:${damaging!.batchId}`;
    setDamages((ds) => [...ds, { ...r, key: k }]);
    setReasons((rs) => { const next = { ...rs }; delete next[k]; return next; }); // 若還有差異，要重新選原因
    setDamaging(null);
    setInfo(`已報損 ${r.productName} ${r.quantity} ${r.unit}（${r.locationCode}，原因：${r.reason}），庫存已扣除。這一格的系統數量已更新為 ${r.after} ${r.unit}，盤點差異只算沒報損的部分，不會重複扣。請繼續盤點。`);
    await baseline.refetch();
    requestAnimationFrame(() => document.getElementById(`st-line-${k}`)?.scrollIntoView({ block: "center" }));
  };

  if (damaging) return <DamageFlow preset={damaging} onDone={finishDamage} onCancel={() => setDamaging(null)} />;

  return (
    <>
    <StepBanner>{baseline.data && baseline.data.items.length === 0 ? "此範圍沒有庫存可盤點，請換範圍" : diffs === 0 ? "請逐格填實盤數量，相符的不用改；填完按「提交盤點」" : missingReasons > 0 ? `有 ${missingReasons} 筆數量與系統不同，請在那一筆下方選擇差異原因` : `${diffs} 筆與系統不同、原因都選好了；確認後按「提交盤點」，提交後要等管理員核准`}</StepBanner>
    {info && <Message kind="ok">{info}</Message>}
    <Card title="新盤點：填入實際清點數量（預設為系統數量）">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        範圍：
        <select className="input mt-0 w-40" value={warehouseId ?? ""} onChange={(e) => { setWarehouseId(Number(e.target.value) || null); setCounts({}); setReasons({}); }}>
          <option value="">全部冷凍庫</option>
          {warehouses.data?.items.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <input className="input mt-0 flex-1 min-w-48" placeholder="備註" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className="divide-y divide-line">
        {baseline.data?.items.map((b) => {
          const c = counted(b);
          const d = c - b.systemQty;
          return (
            <div key={key(b)} id={`st-line-${key(b)}`} className={`flex flex-wrap items-center gap-3 py-3 ${d !== 0 ? "-mx-2 rounded-[10px] bg-warn-soft/40 px-2" : ""}`}>
              <div className="min-w-[200px] flex-1">
                <p className="text-[20px] font-bold">{b.locationCode}　{b.product.name}{b.expiryDate < today && <span className="tag-bad ml-2 align-middle">已過期，請檢查是否腐爛</span>}</p>
                <p className="muted">系統數量 <b className="text-ink">{b.systemQty} {b.product.unit}</b>・進貨 {fmtReceived(b.receivedAt, b.receivedDate)}・到期 {fmtDate(b.expiryDate)}・批次 {b.batchNo}</p>
                {damagedOf(b) > 0 && <p className="text-[17px] font-bold text-ok">✓ 盤點中已報損 {damagedOf(b)} {b.product.unit}（已扣庫存，系統數量已是扣完的數字）</p>}
              </div>
              <label className="flex items-center gap-2 text-[18px]">實盤
                <input type="number" min={0} inputMode="numeric" className="input mt-0 w-28 text-right text-[22px] font-bold" value={c} onChange={(e) => setCounts({ ...counts, [key(b)]: Number(e.target.value) })} aria-label={`${b.locationCode} 實盤數量`} />
                {b.product.unit}
              </label>
              <span className={`w-32 text-right text-[18px] font-bold ${d < 0 ? "text-bad" : d > 0 ? "text-ok" : "text-ink-2"}`}>{d === 0 ? "相符" : `差異 ${d > 0 ? "+" : ""}${d} ${b.product.unit}`}</span>
              {d !== 0 && (
                <div className="basis-full space-y-2 rounded-[10px] border border-line bg-white p-3">
                  <p className="text-[18px] font-bold">請選擇差異原因：</p>
                  <div role="radiogroup" aria-label={`${b.locationCode} 差異原因`} className="flex flex-wrap gap-2">
                    {STOCKTAKE_REASONS.map((r) => {
                      const on = reasonOf(b).code === r.code;
                      return (
                        <button key={r.code} type="button" role="radio" aria-checked={on} onClick={() => setReason(b, { code: r.code })}
                          className={`min-h-[48px] rounded-[10px] border-2 px-4 text-[18px] font-medium ${on ? "border-brand bg-brand-soft" : "border-line bg-white hover:border-brand"}`}>
                          {on ? "✓ " : ""}{r.label}
                        </button>
                      );
                    })}
                  </div>
                  {reasonOf(b).code === "OTHER" && (
                    <input className="input mt-0" placeholder="請說明原因（必填）" value={reasonOf(b).note} onChange={(e) => setReason(b, { note: e.target.value })} aria-label={`${b.locationCode} 其他原因說明`} />
                  )}
                  {reasonOf(b).code === "DAMAGED" && d < 0 && (
                    <div className="flex flex-wrap items-center gap-3 rounded-[10px] bg-warn-soft/60 p-3">
                      <button type="button" className="btn-primary" aria-label={`${b.locationCode} 建立報損`} onClick={() => startDamage(b, -d)}>建立報損</button>
                      <span className="min-w-0 flex-1 text-[16px]">壞掉的 {-d} {b.product.unit} 要丟掉，就直接報損（商品、批次、儲位、數量、原因自動帶入）；報損立即扣庫存，完成後回到這裡繼續盤點，這一格不會再重複扣。</span>
                    </div>
                  )}
                  {reasonMissing(b) && <p className="text-[16px] text-warn">數量與系統不同，要選原因才能提交。</p>}
                </div>
              )}
            </div>
          );
        })}
        {baseline.data?.items.length === 0 && <p className="muted py-2">此範圍沒有庫存可盤點</p>}
      </div>
      {damages.length > 0 && (
        <div className="mt-3 space-y-1 rounded-[10px] border border-line p-3">
          <p className="text-[18px] font-bold">本次盤點已報損 {damages.length} 筆（已扣庫存，提交時一併附上給管理員核對）</p>
          {damages.map((d) => <p key={d.movementId} className="text-[17px]">{d.locationCode}　{d.productName} −{d.quantity} {d.unit}<span className="ml-2 text-ink-2">批次 {d.batchNo}・{d.reason}</span></p>)}
        </div>
      )}
      {submit.error && <Message kind="error">{errorMessage(submit.error)}</Message>}
      <div className="mt-3 flex items-center gap-3">
        <span className="text-[18px] text-ink-2">{diffs} 筆有差異{missingReasons > 0 ? `，${missingReasons} 筆還沒選原因` : ""}</span>
        <button className="btn-primary ml-auto" disabled={!baseline.data?.items.length || baseline.isFetching || submit.isPending || missingReasons > 0} onClick={async () => { if (await dialog.confirm("提交盤點", `${baseline.data!.items.length} 筆明細，${diffs} 筆差異。${damages.length ? `\n盤點中已報損 ${damages.length} 筆（已扣庫存，核准不會再扣）。` : ""}\n提交後不會立即改庫存，需管理員核准。`)) submit.mutate(); }}>提交盤點</button>
      </div>
    </Card>
    </>
  );
}
