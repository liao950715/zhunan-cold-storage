import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { get } from "../api/client";
import { useAllLocations, useProducts } from "../api/hooks";
import type { BatchItem } from "../api/types";
import { SearchIcon } from "./icons";
import { locationWords } from "../lib/words";

interface Suggestion { kind: "商品" | "儲位" | "批次"; text: string; sub?: string }

/**
 * 找貨搜尋框：打一個字就列出建議（商品／儲位／批次），像瀏覽器網址列；
 * 上下鍵選、Enter 送出，點建議直接搜尋。
 */
export default function SearchBox({ initial = "", onSearch, autoFocus = false, placeholder = "輸入商品名稱或儲位，例如：甘藍菜、A-01-02" }: { initial?: string; onSearch: (q: string) => void; autoFocus?: boolean; placeholder?: string }) {
  const [q, setQ] = useState(initial);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);
  const products = useProducts();
  const locations = useAllLocations();
  const batches = useQuery({ queryKey: ["batches", "inStock"], queryFn: () => get<{ items: BatchItem[] }>("/batches?inStockOnly=true") });

  useEffect(() => setQ(initial), [initial]);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const suggestions = useMemo<Suggestion[]>(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    const out: Suggestion[] = [];
    for (const p of products.data?.items ?? []) if (p.name.toLowerCase().includes(term)) out.push({ kind: "商品", text: p.name, sub: `${p.category ?? ""}・${p.unit}` });
    for (const l of locations.data ?? []) if (l.code.toLowerCase().includes(term.replace(/\s/g, ""))) out.push({ kind: "儲位", text: l.code, sub: `${locationWords(l.code)}・${l.occupied ? `${l.product?.name} ${l.quantity} ${l.product?.unit}` : "空位"}` });
    for (const b of batches.data?.items ?? []) if (b.batchNo.toLowerCase().includes(term)) out.push({ kind: "批次", text: b.batchNo, sub: `${b.product.name}・可用 ${b.available} ${b.product.unit}` });
    return out.slice(0, 8);
  }, [q, products.data, locations.data, batches.data]);

  function submit(text = q) {
    const t = text.trim();
    if (!t) return;
    setOpen(false);
    setActive(-1);
    setQ(t);
    onSearch(t);
  }
  function onSubmit(e: FormEvent) {
    e.preventDefault();
    submit(active >= 0 && suggestions[active] ? suggestions[active].text : q);
  }

  return (
    <div ref={boxRef} className="relative">
      <form onSubmit={onSubmit} className="flex gap-3">
        <input
          className="input mt-0 flex-1"
          placeholder={placeholder}
          value={q}
          autoFocus={autoFocus}
          autoComplete="off"
          role="combobox"
          aria-expanded={open && suggestions.length > 0}
          aria-controls="search-suggestions"
          aria-label="搜尋商品或儲位"
          onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(-1); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (!open || suggestions.length === 0) return;
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % suggestions.length); }
            if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a <= 0 ? suggestions.length - 1 : a - 1)); }
            if (e.key === "Escape") setOpen(false);
          }}
        />
        <button className="btn-primary" type="submit"><SearchIcon size={22} />找貨</button>
      </form>
      {open && suggestions.length > 0 && (
        <ul id="search-suggestions" role="listbox" className="absolute left-0 right-0 z-20 mt-1 max-h-[420px] overflow-auto rounded-[10px] border border-line bg-white shadow-lg">
          {suggestions.map((s, i) => (
            <li key={`${s.kind}-${s.text}`} role="option" aria-selected={i === active}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => submit(s.text)} onMouseEnter={() => setActive(i)}
                className={`flex w-full items-center gap-3 px-4 py-3 text-left ${i === active ? "bg-brand-soft" : ""}`}>
                <span className="tag-info w-14 shrink-0 text-center">{s.kind}</span>
                <span className="text-[20px] font-bold">{s.text}</span>
                {s.sub && <span className="muted min-w-0 truncate">{s.sub}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
