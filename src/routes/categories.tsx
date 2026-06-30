import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/categories")({
  head: () => ({
    meta: [
      { title: "Categories & Brands — QuickQuote" },
      { name: "description", content: "Manage product categories and their brands." },
    ],
  }),
  component: CategoriesPage,
});

type Category = { id: string; name: string };
type Brand = { id: string; category_id: string; name: string };

function CategoriesPage() {
  const qc = useQueryClient();
  const [newCat, setNewCat] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const catQ = useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const { data, error } = await supabase.from("categories").select("id,name").order("name");
      if (error) throw error;
      return (data ?? []) as Category[];
    },
  });
  const brandQ = useQuery({
    queryKey: ["brands"],
    queryFn: async () => {
      const { data, error } = await supabase.from("brands").select("id,category_id,name").order("name");
      if (error) throw error;
      return (data ?? []) as Brand[];
    },
  });

  const addCat = useMutation({
    mutationFn: async (name: string) => {
      const { error } = await supabase.from("categories").insert({ name });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["categories"] });
      setNewCat("");
      toast.success("Category added");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const delCat = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("categories").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["categories"] });
      qc.invalidateQueries({ queryKey: ["brands"] });
      toast.success("Category deleted");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const addBrand = useMutation({
    mutationFn: async (payload: { category_id: string; name: string }) => {
      const { error } = await supabase.from("brands").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brands"] });
      toast.success("Brand added");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const delBrand = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("brands").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brands"] });
      toast.success("Brand deleted");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const toggle = (id: string) => {
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const cats = catQ.data ?? [];
  const brands = brandQ.data ?? [];

  return (
    <div className="mx-auto max-w-3xl px-6 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Categories & Brands</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Define the categories the AI is allowed to classify items into, and the brands available per category.
        </p>
      </div>

      <Card className="p-6 space-y-4">
        <div className="flex gap-2">
          <Input
            placeholder="New category name (e.g. Wires, Switches, Plumbing)"
            value={newCat}
            onChange={(e) => setNewCat(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newCat.trim()) addCat.mutate(newCat.trim());
            }}
          />
          <Button onClick={() => newCat.trim() && addCat.mutate(newCat.trim())} disabled={addCat.isPending}>
            <Plus className="h-4 w-4 mr-2" /> Create Category
          </Button>
        </div>

        <div className="border rounded-lg divide-y">
          {cats.length === 0 && (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No categories yet. Add your first one above.
            </div>
          )}
          {cats.map((c) => {
            const isOpen = expanded.has(c.id);
            const myBrands = brands.filter((b) => b.category_id === c.id);
            return (
              <div key={c.id}>
                <div className="flex items-center justify-between p-3">
                  <button
                    onClick={() => toggle(c.id)}
                    className="flex items-center gap-2 font-medium hover:underline"
                  >
                    {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    {c.name}
                    <span className="text-xs text-muted-foreground font-normal">
                      ({myBrands.length} brand{myBrands.length === 1 ? "" : "s"})
                    </span>
                  </button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => {
                      if (confirm(`Delete category "${c.name}" and all its brands?`)) delCat.mutate(c.id);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                {isOpen && (
                  <div className="px-4 pb-4 pl-10 space-y-2 bg-muted/20">
                    <BrandAdder onAdd={(name) => addBrand.mutate({ category_id: c.id, name })} />
                    <div className="flex flex-wrap gap-2">
                      {myBrands.length === 0 && (
                        <p className="text-xs text-muted-foreground">No brands yet.</p>
                      )}
                      {myBrands.map((b) => (
                        <div
                          key={b.id}
                          className="inline-flex items-center gap-1 pl-3 pr-1 py-1 rounded-full border bg-background text-sm"
                        >
                          {b.name}
                          <button
                            onClick={() => delBrand.mutate(b.id)}
                            className="h-5 w-5 rounded-full hover:bg-destructive hover:text-destructive-foreground flex items-center justify-center"
                            title="Delete brand"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function BrandAdder({ onAdd }: { onAdd: (name: string) => void }) {
  const [v, setV] = useState("");
  return (
    <div className="flex gap-2">
      <Input
        placeholder="Add a brand…"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && v.trim()) {
            onAdd(v.trim());
            setV("");
          }
        }}
        className="h-8 max-w-xs"
      />
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          if (v.trim()) {
            onAdd(v.trim());
            setV("");
          }
        }}
      >
        <Plus className="h-3 w-3 mr-1" /> Add Brand
      </Button>
    </div>
  );
}
