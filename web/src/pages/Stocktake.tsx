import { Fragment, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { errorMessage, get, post } from "../api/client";
import { useInvalidateStock, useWarehouses } from "../api/hooks";
import type { BaselineItem, Stocktake as StocktakeT } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { Card, Message, PageTitle, StepBanner, fmtTime } from "../components/ui";
import { useDialog } from "../components/ConfirmDialog";

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
        <Card>
          <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-[16px]">
            <thead className="text-left text-ink-2"><tr><th className="py-1">#</th><th>狀態</th><th>範圍</th><th>提交</th><th className="text-right">明細</th><th className="text-right">差異筆數</th><th>審核</th><th></th></tr></thead>
            <tbody>
              {list.data?.items.map((s) => (
                <Fragment key={s.id}>
                  <tr className="border-t border-line">
                    <td className="py-1.5">{s.id}</td>
                    <td><span className={s.status === "PENDING" ? "tag-warn" : s.status === "APPROVED" ? "tag-ok" : "tag-info"}>{STATUS[s.status]}</span></td>
                    <td>{s.warehouse?.name ?? "全部"}</td>
                    <td className="text-xs">{s.submittedBy.displayName}<br />{fmtTime(s.submittedAt)}</td>
                    <td className="text-right">{s.items.length}</td>
                    <td className="text-right">{s.items.filter((i) => i.diff !== 0).length}</td>
                    <td className="text-xs">{s.reviewedBy ? <>{s.reviewedBy.displayName}<br />{fmtTime(s.reviewedAt!)}{s.reviewNote && <><br />「{s.reviewNote}」</>}</> : "—"}</td>
                    <td className="text-right whitespace-nowrap">
                      <button className="text-brand-deep underline" onClick={() => setOpen(open === s.id ? null : s.id)}>{open === s.id ? "收合" : "明細"}</button>
                      {s.status === "PENDING" && user?.role === "ADMIN" && (
                        <>
                          <button className="btn-sm ml-2" onClick={async () => { const note = await dialog.prompt(`核准盤點 #${s.id}：備註（可留空）`); if (note !== null) review.mutate({ id: s.id, action: "approve", note }); }}>核准</button>
                          <button className="btn-sm ml-2 text-bad" onClick={async () => { const note = await dialog.prompt(`退回盤點 #${s.id}：原因`); if (note !== null) review.mutate({ id: s.id, action: "reject", note }); }}>退回</button>
                        </>
                      )}
                    </td>
                  </tr>
                  {open === s.id && (
                    <tr>
                      <td colSpan={8} className="bg-bg-2 p-3">
                        <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-[16px]">
                          <thead className="text-ink-2"><tr><th className="text-left">儲位</th><th className="text-left">商品</th><th className="text-left">批次</th><th className="text-right">系統基準</th><th className="text-right">實盤</th><th className="text-right">差異</th></tr></thead>
                          <tbody>
                            {s.items.map((i) => (
                              <tr key={i.id} className={i.diff !== 0 ? "font-medium" : ""}>
                                <td>{i.locationCode}</td><td>{i.product.name}</td><td className="font-mono">{i.batchNo}</td><td className="text-right">{i.systemQty}</td><td className="text-right">{i.countedQty}</td>
                                <td className={`text-right ${i.diff < 0 ? "text-bad" : i.diff > 0 ? "text-ok" : "text-ink-2"}`}>{i.diff > 0 ? `+${i.diff}` : i.diff}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table></div>
                        {s.note && <p className="mt-1 text-slate-600">備註：{s.note}</p>}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {list.data?.items.length === 0 && <tr><td colSpan={8} className="py-3 text-center text-ink-2">尚無盤點單</td></tr>}
            </tbody>
          </table></div>
        </Card>
      )}
    </div>
  );
}

function NewStocktake({ onDone }: { onDone: (id: number) => void }) {
  const warehouses = useWarehouses();
  const dialog = useDialog();
  const [warehouseId, setWarehouseId] = useState<number | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [note, setNote] = useState("");
  const baseline = useQuery({ queryKey: ["stocktakeBaseline", warehouseId], queryFn: () => get<{ items: BaselineItem[] }>(`/stocktakes/baseline${warehouseId ? `?warehouseId=${warehouseId}` : ""}`) });
  const key = (b: BaselineItem) => `${b.locationId}:${b.batchId}`;
  const counted = (b: BaselineItem) => counts[key(b)] ?? b.systemQty;

  const submit = useMutation({
    mutationFn: () => post<{ id: number }>("/stocktakes", { warehouseId: warehouseId ?? undefined, note: note || null, items: baseline.data!.items.map((b) => ({ locationId: b.locationId, batchId: b.batchId, countedQty: counted(b) })) }),
    onSuccess: (r) => onDone(r.id),
  });
  const diffs = baseline.data?.items.filter((b) => counted(b) !== b.systemQty).length ?? 0;

  return (
    <>
    <StepBanner>{baseline.data && baseline.data.items.length === 0 ? "此範圍沒有庫存可盤點，請換範圍" : diffs === 0 ? "請逐格填實盤數量，相符的不用改；填完按「提交盤點」" : `已有 ${diffs} 筆與系統不同；確認後按「提交盤點」，提交後要等管理員核准`}</StepBanner>
    <Card title="新盤點：填入實際清點數量（預設為系統數量）">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        範圍：
        <select className="input mt-0 w-40" value={warehouseId ?? ""} onChange={(e) => { setWarehouseId(Number(e.target.value) || null); setCounts({}); }}>
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
            <div key={key(b)} className={`flex flex-wrap items-center gap-3 py-3 ${d !== 0 ? "-mx-2 rounded-[10px] bg-warn-soft/40 px-2" : ""}`}>
              <div className="min-w-[200px] flex-1">
                <p className="text-[20px] font-bold">{b.locationCode}　{b.product.name}</p>
                <p className="muted">系統數量 <b className="text-ink">{b.systemQty} {b.product.unit}</b>・到期 {b.expiryDate}・批次 {b.batchNo}</p>
              </div>
              <label className="flex items-center gap-2 text-[18px]">實盤
                <input type="number" min={0} inputMode="numeric" className="input mt-0 w-28 text-right text-[22px] font-bold" value={c} onChange={(e) => setCounts({ ...counts, [key(b)]: Number(e.target.value) })} aria-label={`${b.locationCode} 實盤數量`} />
                {b.product.unit}
              </label>
              <span className={`w-24 text-right text-[18px] font-bold ${d < 0 ? "text-bad" : d > 0 ? "text-ok" : "text-ink-2"}`}>{d === 0 ? "相符" : d > 0 ? `多 ${d}` : `少 ${-d}`}</span>
            </div>
          );
        })}
        {baseline.data?.items.length === 0 && <p className="muted py-2">此範圍沒有庫存可盤點</p>}
      </div>
      {submit.error && <Message kind="error">{errorMessage(submit.error)}</Message>}
      <div className="mt-3 flex items-center gap-3">
        <span className="text-[18px] text-ink-2">{diffs} 筆有差異</span>
        <button className="btn-primary ml-auto" disabled={!baseline.data?.items.length || submit.isPending} onClick={async () => { if (await dialog.confirm("提交盤點", `${baseline.data!.items.length} 筆明細，${diffs} 筆差異。\n提交後不會立即改庫存，需管理員核准。`)) submit.mutate(); }}>提交盤點</button>
      </div>
    </Card>
    </>
  );
}
