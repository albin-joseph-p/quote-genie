import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";

import { Card } from "@/components/ui/card";
import { fetchAllRows } from "@/lib/fetch-all";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/categories")({
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

  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (name: string) =>
    setOpen((prev) => ({ ...prev, [name]: !(prev[name] ?? true) }));
  const isOpen = (name: string) => open[name] ?? true;

  return (
    <div className="mx-auto max-w-3xl px-6 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Categories & Brands</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Automatically derived from Master Inventory. Click a category to hide or show its brands.
          Click any brand to jump to Master Inventory filtered to that brand.
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
            {grouped.map((c) => {
              const opened = isOpen(c.name);
              return (
                <div key={c.name} className="p-3">
                  <button
                    type="button"
                    onClick={() => toggle(c.name)}
                    className="flex items-center gap-2 font-medium w-full text-left hover:text-primary transition-colors"
                    aria-expanded={opened}
                  >
                    <ChevronRight
                      className={cn(
                        "h-4 w-4 text-muted-foreground transition-transform",
                        opened && "rotate-90",
                      )}
                    />
                    {c.name}
                    <span className="text-xs text-muted-foreground font-normal">
                      ({c.brands.length} brand{c.brands.length === 1 ? "" : "s"})
                    </span>
                  </button>
                  {opened && c.brands.length > 0 && (
                    <div className="flex flex-wrap gap-2 pl-6 pt-2">
                      {c.brands.map((b) => (
                        <Link
                          key={b}
                          to="/master"
                          search={{ brand: b }}
                          className="inline-flex items-center px-3 py-1 rounded-full border bg-background text-sm hover:bg-accent hover:border-primary transition-colors"
                        >
                          {b}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
