import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { errorMessage, post } from "../api/client";
import { useProducts } from "../api/hooks";
import type { Product } from "../api/types";
import { Field, Message } from "./ui";

/**
 * 商品選擇：搜尋＋下拉；商品不存在時可直接新增並回到原流程（FR-008）。
 */
export default function ProductSelect({ value, onChange, allowCreate = true }: { value: number | null; onChange: (p: Product | null) => void; allowCreate?: boolean }) {
  const products = useProducts();
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const items = (products.data?.items ?? []).filter((p) => !q || p.name.includes(q));

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input className="input mt-0 flex-1" placeholder="搜尋商品名稱…" value={q} onChange={(e) => setQ(e.target.value)} />
        {allowCreate && (
          <button type="button" className="btn" onClick={() => setCreating(true)}>＋ 新增商品</button>
        )}
      </div>
      <select className="input mt-0" value={value ?? ""} onChange={(e) => onChange(products.data?.items.find((p) => p.id === Number(e.target.value)) ?? null)} size={Math.min(6, Math.max(2, items.length + 1))}>
        <option value="">— 請選擇商品 —</option>
        {items.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}（{p.unit}）{p.category ? ` · ${p.category}` : ""}
          </option>
        ))}
      </select>
      {creating && (
        <CreateProductInline
          initialName={q}
          onCancel={() => setCreating(false)}
          onCreated={(p) => {
            setCreating(false);
            setQ("");
            onChange(p);
          }}
        />
      )}
    </div>
  );
}

export function CreateProductInline({ initialName = "", onCreated, onCancel }: { initialName?: string; onCreated: (p: Product) => void; onCancel: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: initialName, category: "", unit: "籠", lowStockThreshold: 10, expiryAlertDays: 14 });
  const m = useMutation({
    mutationFn: () => post<Product>("/products", { ...form, category: form.category || null }),
    onSuccess: async (p) => {
      await qc.invalidateQueries({ queryKey: ["products"] });
      onCreated(p);
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    m.mutate();
  }
  return (
    <form onSubmit={submit} className="rounded border border-sky-200 bg-sky-50 p-3 space-y-2">
      <p className="text-sm font-medium text-sky-900">新增商品（完成後自動帶回）</p>
      <div className="grid grid-cols-2 gap-2">
        <Field label="名稱 *"><input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="類別"><input className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></Field>
        <Field label="計量單位 *"><input className="input" required value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} /></Field>
        <Field label="低庫存警戒值"><input type="number" min={0} className="input" value={form.lowStockThreshold} onChange={(e) => setForm({ ...form, lowStockThreshold: Number(e.target.value) })} /></Field>
        <Field label="效期提醒天數"><input type="number" min={0} className="input" value={form.expiryAlertDays} onChange={(e) => setForm({ ...form, expiryAlertDays: Number(e.target.value) })} /></Field>
      </div>
      {m.error && <Message kind="error">{errorMessage(m.error)}</Message>}
      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={m.isPending}>建立商品</button>
        <button type="button" className="btn" onClick={onCancel}>取消</button>
      </div>
    </form>
  );
}
