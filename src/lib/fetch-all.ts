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

  // First page doubles as the count request, so small tables cost one round-trip.
  let firstQ = supabase
    .from(table as never)
    .select(columns, { count: "exact" })
    .range(0, pageSize - 1);
  if (orderBy) firstQ = firstQ.order(orderBy) as typeof firstQ;
  const first = await firstQ;
  if (first.error) throw first.error;
  const rows = (first.data ?? []) as unknown as T[];
  const total = Math.min(first.count ?? rows.length, maxRows);
  if (total <= rows.length) return rows;

  const pages = Math.ceil(total / pageSize) - 1;
  const chunks = await Promise.all(
    Array.from({ length: pages }, (_, i) => {
      const from = (i + 1) * pageSize;
      const to = Math.min(from + pageSize - 1, total - 1);
      let q = supabase.from(table as never).select(columns).range(from, to);
      if (orderBy) q = q.order(orderBy) as typeof q;
      return q.then(({ data, error }) => {
        if (error) throw error;
        return (data ?? []) as unknown as T[];
      });
    }),
  );
  return rows.concat(...chunks);
}

