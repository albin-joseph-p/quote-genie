import { supabase } from "@/integrations/supabase/client";

// Supabase caps a single request at 1000 rows. Paginate to fetch all rows.
export async function fetchAllRows<T>(
  table: string,
  columns: string,
  opts: { orderBy?: string; pageSize?: number; maxRows?: number } = {},
): Promise<T[]> {
  const { orderBy, pageSize = 1000, maxRows = 20000 } = opts;
  const out: T[] = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const to = Math.min(from + pageSize - 1, maxRows - 1);
    let q = supabase.from(table as never).select(columns).range(from, to);
    if (orderBy) q = q.order(orderBy) as typeof q;
    const { data, error } = await q;
    if (error) throw error;
    const rows = (data ?? []) as unknown as T[];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}
