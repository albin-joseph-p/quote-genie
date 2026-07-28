import { queryOptions } from "@tanstack/react-query";
import { fetchAllRows } from "./fetch-all";

export type InventoryItem = {
  item_code: string;
  item_name: string;
  category: string | null;
  brand: string;
  comp_code: string;
};

const CACHE_KEY = "orion:inventory:v1";
const CACHE_TTL = 10 * 60_000;

type Cached = { at: number; rows: InventoryItem[] };

function readCache(): Cached | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.sessionStorage.getItem(CACHE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Cached;
    if (!parsed?.rows || Date.now() - parsed.at > CACHE_TTL) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function writeCache(rows: InventoryItem[]) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), rows }));
  } catch {
    /* quota exceeded — cache is best-effort */
  }
}

export function clearInventoryCache() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(CACHE_KEY);
  } catch {
    /* ignore */
  }
}

export const INVENTORY_QUERY_KEY = ["inventory"] as const;

/**
 * Single source of truth for inventory across every page. All pages share one
 * query key (and one network fetch); a short-lived sessionStorage snapshot
 * makes the first paint after a reload instant.
 */
export const inventoryQueryOptions = queryOptions({
  queryKey: INVENTORY_QUERY_KEY,
  queryFn: async () => {
    const rows = await fetchAllRows<InventoryItem>(
      "inventory",
      "item_code,item_name,category,brand,comp_code",
    );
    writeCache(rows);
    return rows;
  },
  initialData: () => readCache()?.rows,
  initialDataUpdatedAt: () => readCache()?.at,
  staleTime: 5 * 60_000,
  gcTime: 30 * 60_000,
});
