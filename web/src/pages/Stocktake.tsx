import { Fragment, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { errorMessage, get, post } from "../api/client";
import { useInvalidateStock, useWarehouses } from "../api/hooks";
import type { BaselineItem, Stocktake as StocktakeT } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { Card, Message, PageTitle, fmtTime } from "../components/ui";
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
      <div className="flex gap-2">
        <button className={tab === "list" ? "btn-primary" : "btn"} onClick={() => setTab("list")}>盤點單</button>
        <button className={tab === "new" ? "btn-primary" : "btn"} onClick={() => setTab("new")}>＋ 新盤點</button>
      </div>
      {msg && <Message kind={msg.kind}>{msg.text}</Message>}
      {tab === "new" && <NewStocktake onDone={async (id) => { await invalidate(); setTab("list"); setMsg({ kind: "ok", text: `盤點單 #${id} 已提交，等待管理員核准；正式庫存尚未變動` }); }} />}
      {tab === "list" && (
        <Card>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500"><tr><th className="py-1">#</th><th>狀態</th><th>範圍</th><th>提交</th><th className="text-right">明細</th><th className="text-right">差異筆數</th><th>審核</th><th></th></tr></thead>
            <tbody>
              {list.data?.items.map((s) => (
                <Fragment key={s.id}>
                  <tr className="border-t border-slate-100">
                    <td className="py-1.5">{s.id}</td>
                    <td><span className={`rounded px-1.5 py-0.5 text-xs ${s.status === "PENDING" ? "bg-amber-100 text-amber-800" : s.status === "APPROVED" ? "bg-green-100 text-green-800" : "bg-slate-100 text-slate-600"}`}>{STATUS[s.status]}</span></td>
                    <td>{s.warehouse?.name ?? "全部"}</td>
                    <td className="text-xs">{s.submittedBy.displayName}<br />{fmtTime(s.submittedAt)}</td>
                    <td className="text-right">{s.items.length}</td>
                    <td className="text-right">{s.items.filter((i) => i.diff !== 0).length}</td>
                    <td className="text-xs">{s.reviewedBy ? <>{s.reviewedBy.displayName}<br />{fmtTime(s.reviewedAt!)}{s.reviewNote && <><br />「{s.reviewNote}」</>}</> : "—"}</td>
                    <td className="text-right whitespace-nowrap">
                      <button className="text-sky-700 hover:underline" onClick={() => setOpen(open === s.id ? null : s.id)}>{open === s.id ? "收合" : "明細"}</button>
                      {s.status === "PENDING" && user?.role === "ADMIN" && (
                        <>
                          <button className="ml-3 text-green-700 hover:underline" onClick={async () => { const note = await dialog.prompt(`核准盤點 #${s.id}：備註（可留空）`); if (note !== null) review.mutate({ id: s.id, action: "approve", note }); }}>核准</button>
                          <button className="ml-3 text-red-700 hover:underline" onClick={async () => { const note = await dialog.prompt(`退回盤點 #${s.id}：原因`); if (note !== null) review.mutate({ id: s.id, action: "reject", note }); }}>退回</button>
                        </>
                      )}
                    </td>
                  </tr>
                  {open === s.id && (
                    <tr>
                      <td colSpan={8} className="bg-slate-50 p-2">
                        <table className="w-full text-xs">
                          <thead className="text-slate-500"><tr><th className="text-left">儲位</th><th className="text-left">商品</th><th className="text-left">批次</th><th className="text-right">系統基準</th><th className="text-right">實盤</th><th className="text-right">差異</th></tr></thead>
                          <tbody>
                            {s.items.map((i) => (
                              <tr key={i.id} className={i.diff !== 0 ? "font-medium" : ""}>
                                <td>{i.locationCode}</td><td>{i.product.name}</td><td className="font-mono">{i.batchNo}</td><td className="text-right">{i.systemQty}</td><td className="text-right">{i.countedQty}</td>
                                <td className={`text-right ${i.diff < 0 ? "text-red-600" : i.diff > 0 ? "text-green-700" : "text-slate-400"}`}>{i.diff > 0 ? `+${i.diff}` : i.diff}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {s.note && <p className="mt-1 text-slate-600">備註：{s.note}</p>}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {list.data?.items.length === 0 && <tr><td colSpan={8} className="py-3 text-center text-slate-500">尚無盤點單</td></tr>}
            </tbody>
          </table>
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
    <Card title="新盤點：填入實際清點數量（預設為系統數量）">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        範圍：
        <select className="input mt-0 w-40" value={warehouseId ?? ""} onChange={(e) => { setWarehouseId(Number(e.target.value) || null); setCounts({}); }}>
          <option value="">全部冷凍庫</option>
          {warehouses.data?.items.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <input className="input mt-0 flex-1 min-w-48" placeholder="備註" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-slate-500"><tr><th className="py-1">儲位</th><th>商品</th><th>批次</th><th>到期日</th><th className="text-right">系統數量</th><th className="text-right w-28">實盤數量</th><th className="text-right">差異</th></tr></thead>
        <tbody>
          {baseline.data?.items.map((b) => {
            const c = counted(b);
            return (
              <tr key={key(b)} className={`border-t border-slate-100 ${c !== b.systemQty ? "bg-amber-50" : ""}`}>
                <td className="py-1 font-medium">{b.locationCode}</td><td>{b.product.name}</td><td className="font-mono text-xs">{b.batchNo}</td><td>{b.expiryDate}</td>
                <td className="text-right">{b.systemQty} {b.product.unit}</td>
                <td className="text-right"><input type="number" min={0} className="input mt-0 text-right" value={c} onChange={(e) => setCounts({ ...counts, [key(b)]: Number(e.target.value) })} /></td>
                <td className={`text-right ${c - b.systemQty < 0 ? "text-red-600" : c - b.systemQty > 0 ? "text-green-700" : "text-slate-400"}`}>{c - b.systemQty > 0 ? "+" : ""}{c - b.systemQty}</td>
              </tr>
            );
          })}
          {baseline.data?.items.length === 0 && <tr><td colSpan={7} className="py-2 text-slate-500">此範圍沒有庫存可盤點</td></tr>}
        </tbody>
      </table>
      {submit.error && <Message kind="error">{errorMessage(submit.error)}</Message>}
      <div className="mt-3 flex items-center gap-3">
        <span className="text-sm text-slate-600">{diffs} 筆有差異</span>
        <button className="btn-primary ml-auto" disabled={!baseline.data?.items.length || submit.isPending} onClick={async () => { if (await dialog.confirm("提交盤點", `${baseline.data!.items.length} 筆明細，${diffs} 筆差異。\n提交後不會立即改庫存，需管理員核准。`)) submit.mutate(); }}>提交盤點</button>
      </div>
    </Card>
  );
}
