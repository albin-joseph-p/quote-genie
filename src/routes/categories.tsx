import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";

import { Card } from "@/components/ui/card";
import { fetchAllRows } from "@/lib/fetch-all";

export const Route = createFileRoute("/categories")({
  head: () => ({
    meta: [
      { title: "Categories & Brands — Orion Sales Corporation" },
      { name: "description", content: "Categories and brands, always derived from Master Inventory." },
    ],
  }),
  component: CategoriesPage,
});

type InvRow = { item_code: string; category: string | null; brand: string };

function CategoriesPage() {
  const invQ = useQuery({
    queryKey: ["inventory", "taxonomy"],
    queryFn: () => fetchAllRows<InvRow>("inventory", "item_code,category,brand"),
  });

  const grouped = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const r of invQ.data ?? []) {
      const cat = (r.category ?? "").trim();
      if (!cat) continue;
      if (!map.has(cat)) map.set(cat, new Set());
      const brand = (r.brand ?? "").trim();
      if (brand) map.get(cat)!.add(brand);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, brands]) => ({
        name,
        brands: Array.from(brands).sort((a, b) => a.localeCompare(b)),
      }));
  }, [invQ.data]);

  return (
    <div className="mx-auto max-w-3xl px-6 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Categories & Brands</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Automatically derived from Master Inventory. Add, remove, or rename items in the Master
          Inventory tab and this list updates instantly. Rows without a category are ignored.
        </p>
      </div>

      <Card className="p-6 space-y-4">
        {invQ.isLoading ? (
          <p className="text-sm text-muted-foreground text-center py-8">Loading…</p>
        ) : grouped.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            No categories found in Master Inventory yet.
          </p>
        ) : (
          <div className="border rounded-lg divide-y">
            {grouped.map((c) => (
              <div key={c.name} className="p-3">
                <div className="flex items-center gap-2 font-medium">
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  {c.name}
                  <span className="text-xs text-muted-foreground font-normal">
                    ({c.brands.length} brand{c.brands.length === 1 ? "" : "s"})
                  </span>
                </div>
                {c.brands.length > 0 && (
                  <div className="flex flex-wrap gap-2 pl-6 pt-2">
                    {c.brands.map((b) => (
                      <span
                        key={b}
                        className="inline-flex items-center px-3 py-1 rounded-full border bg-background text-sm"
                      >
                        {b}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
