import type { PostgrestFilterBuilder } from "@supabase/postgrest-js";

// Supabase caps a single request at 1000 rows. Paginate to fetch all rows.
export async function fetchAllRows<T>(
  build: () => PostgrestFilterBuilder<any, any, T[], any, any>,
  pageSize = 1000,
  maxRows = 20000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const to = Math.min(from + pageSize - 1, maxRows - 1);
    const { data, error } = await build().range(from, to);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}
