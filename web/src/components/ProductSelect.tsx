import { useEffect, useState, type FormEvent } from "react";
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
  const all = products.data?.items ?? [];
  const selected = all.find((p) => p.id === value) ?? null;
  const items = all.filter((p) => !q || p.name.includes(q));
  // 選好商品（點選、或從別頁帶進來）就把名稱填進下面的篩選框：清單縮成這一項，一看就知道選了什麼；要換按「顯示全部商品」
  useEffect(() => {
    if (selected) setQ(selected.name);
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-3">
      {/* 唯讀顯示：不是輸入框。點下面的商品，這裡就會顯示選了哪一個 */}
      <div role="status" aria-live="polite" className={`rounded-[12px] px-4 py-3 text-[22px] ${selected ? "border-2 border-brand bg-brand-soft" : "border-2 border-dashed border-line bg-bg-2 text-ink-2"}`}>
        {selected ? <>目前選擇：<b className="text-ink">{selected.name}</b><span className="ml-2 text-[18px] text-ink-2">（單位：{selected.unit}）</span></> : "目前選擇：尚未選擇，請點下面的商品"}
      </div>

      <p className="text-[18px] font-bold">請點選商品：</p>
      <div role="radiogroup" aria-label="商品" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {items.map((p) => {
          const on = p.id === value;
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => { setQ(p.name); onChange(p); }}
              className={`flex min-h-[56px] items-center justify-between gap-2 rounded-[10px] border-2 px-3 text-left text-[20px] font-medium ${on ? "border-brand bg-brand-soft text-ink" : "border-line bg-white text-ink hover:border-brand"}`}
            >
              <span>{on && <span aria-hidden="true" className="mr-1 text-brand-deep">✓</span>}{p.name}</span>
              <span className="text-[16px] text-ink-2">{p.unit}</span>
            </button>
          );
        })}
        {products.data && items.length === 0 && <p className="col-span-full text-[18px] text-ink-2">找不到名稱含「{q}」的商品。</p>}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-[220px] flex-1">
          <span className="block text-[16px] text-ink-2">商品太多找不到？輸入名稱縮小上面的清單（可不填）</span>
          <input className="input mt-1" placeholder="例如：甘藍" value={q} onChange={(e) => setQ(e.target.value)} aria-label="縮小商品清單" />
        </label>
        {q && <button type="button" className="btn" onClick={() => setQ("")}>顯示全部商品</button>}
        {allowCreate && (
          <button type="button" className="btn" onClick={() => setCreating(true)}>找不到？新增商品</button>
        )}
      </div>
      {creating && (
        <CreateProductInline
          initialName={q}
          onCancel={() => setCreating(false)}
          onCreated={(p) => {
            setCreating(false);
            setQ(p.name);
            onChange(p);
          }}
        />
      )}
    </div>
  );
}

export function CreateProductInline({ initialName = "", onCreated, onCancel }: { initialName?: string; onCreated: (p: Product) => void; onCancel: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: initialName, category: "", unit: "箱", lowStockThreshold: 10, expiryAlertDays: 14 });
  const m = useMutation({
    mutationFn: () => post<Product>("/products", { ...form, name: form.name.trim(), unit: form.unit.trim(), category: form.category.trim() || null }),
    onSuccess: async (p) => {
      await qc.invalidateQueries({ queryKey: ["products"] });
      onCreated(p);
    },
  });
  const nameBlank = form.name.trim().length === 0;
  function submit(e: FormEvent) {
    e.preventDefault();
    if (nameBlank || form.unit.trim().length === 0) return; // 只有空白不算名稱
    m.mutate();
  }
  return (
    <form onSubmit={submit} className="rounded-lg border border-line bg-brand-soft p-4 space-y-3">
      <p className="text-[18px] font-bold">新增商品（建立後會自動選好）</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="名稱 *" hint={form.name.length > 0 && nameBlank ? <span className="text-bad">名稱不能只有空白</span> : undefined}><input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="類別"><input className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></Field>
        <Field label="計量單位 *"><input className="input" required value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} /></Field>
        <Field label="低庫存警戒值"><input type="number" min={0} className="input" value={form.lowStockThreshold} onChange={(e) => setForm({ ...form, lowStockThreshold: Number(e.target.value) })} /></Field>
        <Field label="效期提醒天數"><input type="number" min={0} className="input" value={form.expiryAlertDays} onChange={(e) => setForm({ ...form, expiryAlertDays: Number(e.target.value) })} /></Field>
      </div>
      {m.error && <Message kind="error">{errorMessage(m.error)}</Message>}
      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={m.isPending || nameBlank || form.unit.trim().length === 0}>建立商品</button>
        <button type="button" className="btn" onClick={onCancel}>取消</button>
      </div>
    </form>
  );
}
