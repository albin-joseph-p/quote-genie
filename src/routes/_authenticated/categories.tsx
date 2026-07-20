import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Star, X } from "lucide-react";
import { toast } from "sonner";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { fetchAllRows } from "@/lib/fetch-all";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

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
type DefaultRow = { category: string; brand: string };

function CategoriesPage() {
  const qc = useQueryClient();
  const invQ = useQuery({
    queryKey: ["inventory", "taxonomy"],
    queryFn: () => fetchAllRows<InvRow>("inventory", "item_code,category,brand"),
  });

  const defaultsQ = useQuery({
    queryKey: ["category_defaults"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("category_defaults")
        .select("category,brand");
      if (error) throw error;
      return (data ?? []) as DefaultRow[];
    },
  });

  const defaults = useMemo(() => {
    const m: Record<string, string> = {};
    for (const d of defaultsQ.data ?? []) m[d.category] = d.brand;
    return m;
  }, [defaultsQ.data]);

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

  const setDefaultBrand = async (category: string, brand: string) => {
    const { error } = await supabase
      .from("category_defaults")
      .upsert({ category, brand }, { onConflict: "category" });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Default for ${category} set to ${brand}`);
    qc.invalidateQueries({ queryKey: ["category_defaults"] });
  };

  const clearDefault = async (category: string) => {
    const { error } = await supabase.from("category_defaults").delete().eq("category", category);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Default cleared for ${category}`);
    qc.invalidateQueries({ queryKey: ["category_defaults"] });
  };

  return (
    <div className="mx-auto max-w-3xl px-6 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Categories & Brands</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Automatically derived from Master Inventory. Click a category to hide or show its brands.
          Click any brand to jump to Master Inventory filtered to that brand. Set a default brand
          per category — image matching will prefer that brand first.
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
              const defaultBrand = defaults[c.name] ?? "";
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
                    {defaultBrand && (
                      <span className="ml-auto inline-flex items-center gap-1 text-xs text-primary font-normal">
                        <Star className="h-3 w-3 fill-current" />
                        {defaultBrand}
                      </span>
                    )}
                  </button>
                  {opened && (
                    <>
                      {c.brands.length > 0 && (
                        <div className="flex flex-wrap gap-2 pl-6 pt-2">
                          {c.brands.map((b) => (
                            <Link
                              key={b}
                              to="/master"
                              search={{ brand: b }}
                              className={cn(
                                "inline-flex items-center px-3 py-1 rounded-full border bg-background text-sm hover:bg-accent hover:border-primary transition-colors",
                                b === defaultBrand && "border-primary bg-primary/5 text-primary font-medium",
                              )}
                            >
                              {b === defaultBrand && <Star className="h-3 w-3 fill-current mr-1" />}
                              {b}
                            </Link>
                          ))}
                        </div>
                      )}
                      <div className="pl-6 pt-3 flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">Default brand:</span>
                        <DefaultBrandPicker
                          brands={c.brands}
                          value={defaultBrand}
                          onSelect={(b) => setDefaultBrand(c.name, b)}
                        />
                        {defaultBrand && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            onClick={() => clearDefault(c.name)}
                          >
                            <X className="h-3 w-3 mr-1" /> Clear
                          </Button>
                        )}
                      </div>
                    </>
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

function DefaultBrandPicker({
  brands,
  value,
  onSelect,
}: {
  brands: string[];
  value: string;
  onSelect: (b: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-7 text-xs">
          {value || "Select brand…"}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-64" align="start">
        <Command>
          <CommandInput placeholder="Search brand…" />
          <CommandList>
            <CommandEmpty>No brands.</CommandEmpty>
            <CommandGroup>
              {brands.map((b) => (
                <CommandItem
                  key={b}
                  value={b}
                  onSelect={() => {
                    onSelect(b);
                    setOpen(false);
                  }}
                >
                  {b}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
