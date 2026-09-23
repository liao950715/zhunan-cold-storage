import { useQuery, useQueryClient } from "@tanstack/react-query";
import { get } from "./client";
import type { LayoutLocation, Product, WarehouseLayout, WarehouseSummary } from "./types";

export const useProducts = (includeInactive = false) =>
  useQuery({ queryKey: ["products", includeInactive], queryFn: () => get<{ items: Product[] }>(`/products?includeInactive=${includeInactive}`) });

export const useWarehouses = () => useQuery({ queryKey: ["warehouses"], queryFn: () => get<{ items: WarehouseSummary[] }>("/warehouses") });

export const useLayout = (warehouseId: number | null | undefined) =>
  useQuery({ queryKey: ["layout", warehouseId], queryFn: () => get<WarehouseLayout>(`/warehouses/${warehouseId}/layout`), enabled: !!warehouseId });

export interface LocationOption extends LayoutLocation {
  warehouseId: number;
  warehouseCode: string;
  rackCode: string;
}

/** 所有冷凍庫的儲位清單（含占用狀態），供入庫／搬移的儲位選擇。 */
export function useAllLocations() {
  const wh = useWarehouses();
  return useQuery({
    queryKey: ["allLocations", wh.data?.items.map((w) => `${w.id}:${w.layoutVersion}`).join(",")],
    enabled: !!wh.data,
    queryFn: async () => {
      const layouts = await Promise.all(wh.data!.items.map((w) => get<WarehouseLayout>(`/warehouses/${w.id}/layout`)));
      const out: LocationOption[] = [];
      for (const l of layouts) for (const r of l.racks) for (const loc of r.locations) out.push({ ...loc, warehouseId: l.id, warehouseCode: l.code, rackCode: r.code });
      return out.sort((a, b) => a.code.localeCompare(b.code));
    },
  });
}

/** 庫存操作成功後讓相關查詢失效。 */
export function useInvalidateStock() {
  const qc = useQueryClient();
  return () => Promise.all([
    qc.invalidateQueries({ queryKey: ["layout"] }),
    qc.invalidateQueries({ queryKey: ["allLocations"] }),
    qc.invalidateQueries({ queryKey: ["location"] }),
    qc.invalidateQueries({ queryKey: ["dashboard"] }),
    qc.invalidateQueries({ queryKey: ["search"] }),
    qc.invalidateQueries({ queryKey: ["productStock"] }),
    qc.invalidateQueries({ queryKey: ["batches"] }),
    qc.invalidateQueries({ queryKey: ["movements"] }),
    qc.invalidateQueries({ queryKey: ["stocktakes"] }),
  ]);
}

export const todayStr = () => new Date().toISOString().slice(0, 10);
export const addDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
