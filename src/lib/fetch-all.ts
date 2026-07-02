import { supabase } from "@/integrations/supabase/client";

// Supabase caps a single request at 1000 rows. Get an exact count, then fire
// all range requests in parallel so a 15k-row inventory loads in ~1 round-trip
// instead of 15 sequential ones.
export async function fetchAllRows<T>(
  table: string,
  columns: string,
  opts: { orderBy?: string; pageSize?: number; maxRows?: number } = {},
): Promise<T[]> {
  const { orderBy, pageSize = 1000, maxRows = 50000 } = opts;

  // HEAD request to learn the total row count without shipping any rows.
  const head = await supabase
    .from(table as never)
    .select(columns, { count: "exact", head: true });
  if (head.error) throw head.error;
  const total = Math.min(head.count ?? 0, maxRows);
  if (total === 0) return [];

  const pages = Math.ceil(total / pageSize);
  const chunks = await Promise.all(
    Array.from({ length: pages }, (_, i) => {
      const from = i * pageSize;
      const to = Math.min(from + pageSize - 1, total - 1);
      let q = supabase.from(table as never).select(columns).range(from, to);
      if (orderBy) q = q.order(orderBy) as typeof q;
      return q.then(({ data, error }) => {
        if (error) throw error;
        return (data ?? []) as unknown as T[];
      });
    }),
  );
  return chunks.flat();
}
