import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { errorMessage, patch } from "../api/client";
import { useProducts } from "../api/hooks";
import type { Product } from "../api/types";
import { CreateProductInline } from "../components/ProductSelect";
import { Card, Field, Message, PageTitle } from "../components/ui";

export default function Products() {
  const [showInactive, setShowInactive] = useState(false);
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const products = useProducts(showInactive);
  const qc = useQueryClient();
  const items = (products.data?.items ?? []).filter((p) => !q || p.name.includes(q) || (p.category ?? "").includes(q));

  const toggle = useMutation({
    mutationFn: (p: Product) => patch(`/products/${p.id}`, { status: p.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["products"] }),
    onError: (e) => setMsg({ kind: "error", text: errorMessage(e) }),
  });

  return (
    <div className="space-y-3">
      <PageTitle sub="每種商品自行設定單位、低庫存警戒值與效期提醒天數">商品管理</PageTitle>
      <div className="flex flex-wrap items-center gap-2">
        <input className="input mt-0 w-56" placeholder="搜尋名稱／類別" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="text-[16px]"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> 顯示已停用</label>
        <button className="btn-primary ml-auto" onClick={() => setCreating(true)}>＋ 新增商品</button>
      </div>
      {msg && <Message kind={msg.kind}>{msg.text}</Message>}
      {creating && <CreateProductInline onCancel={() => setCreating(false)} onCreated={(p) => { setCreating(false); setMsg({ kind: "ok", text: `已新增商品「${p.name}」` }); }} />}
      {editing && <EditProduct product={editing} onDone={(text) => { setEditing(null); if (text) setMsg({ kind: "ok", text }); }} />}
      <Card>
        <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-[16px]">
          <thead className="text-left text-ink-2">
            <tr><th className="py-1">名稱</th><th>類別</th><th>單位</th><th className="text-right">低庫存警戒</th><th className="text-right">效期提醒</th><th>狀態</th><th></th></tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id} className={`border-t border-line ${p.status === "INACTIVE" ? "text-ink-2" : ""}`}>
                <td className="py-1.5 font-medium">{p.name}</td>
                <td>{p.category ?? "—"}</td>
                <td>{p.unit}</td>
                <td className="text-right">{p.lowStockThreshold}</td>
                <td className="text-right">{p.expiryAlertDays} 天</td>
                <td>{p.status === "ACTIVE" ? "啟用" : "停用"}</td>
                <td className="text-right whitespace-nowrap">
                  <button className="text-brand-deep underline mr-3" onClick={() => setEditing(p)}>編輯</button>
                  <button className="text-ink-2 hover:underline" onClick={() => toggle.mutate(p)}>{p.status === "ACTIVE" ? "停用" : "啟用"}</button>
                </td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={7} className="py-3 text-center text-ink-2">沒有符合的商品</td></tr>}
          </tbody>
        </table></div>
      </Card>
    </div>
  );
}

function EditProduct({ product, onDone }: { product: Product; onDone: (msg?: string) => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: product.name, category: product.category ?? "", unit: product.unit, lowStockThreshold: product.lowStockThreshold, expiryAlertDays: product.expiryAlertDays, note: product.note ?? "" });
  const m = useMutation({
    mutationFn: () => patch<Product>(`/products/${product.id}`, { ...form, category: form.category || null, note: form.note || null }),
    onSuccess: async (p) => {
      await qc.invalidateQueries({ queryKey: ["products"] });
      onDone(`已更新商品「${p.name}」`);
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    m.mutate();
  }
  return (
    <form onSubmit={submit} className="rounded border border-slate-300 bg-white p-3 space-y-2">
      <p className="font-medium">編輯商品 #{product.id}</p>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        <Field label="名稱 *"><input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="類別"><input className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></Field>
        <Field label="計量單位 *" hint="已有批次的商品不可更改單位"><input className="input" required value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} /></Field>
        <Field label="低庫存警戒值"><input type="number" min={0} className="input" value={form.lowStockThreshold} onChange={(e) => setForm({ ...form, lowStockThreshold: Number(e.target.value) })} /></Field>
        <Field label="效期提醒天數"><input type="number" min={0} className="input" value={form.expiryAlertDays} onChange={(e) => setForm({ ...form, expiryAlertDays: Number(e.target.value) })} /></Field>
        <Field label="備註"><input className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
      </div>
      {m.error && <Message kind="error">{errorMessage(m.error)}</Message>}
      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={m.isPending}>儲存</button>
        <button type="button" className="btn" onClick={() => onDone()}>取消</button>
      </div>
    </form>
  );
}
