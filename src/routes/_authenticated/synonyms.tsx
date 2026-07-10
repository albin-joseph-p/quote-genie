import { createFileRoute } from "@tanstack/react-router";
import { memo, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Save, Check, ChevronsUpDown } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetch-all";

export const Route = createFileRoute("/_authenticated/synonyms")({
  head: () => ({
    meta: [
      { title: "Synonyms — Orion Sales Corporation" },
      { name: "description", content: "Hardcode customer-term to internal-item-code mappings." },
    ],
  }),
  component: SynonymsPage,
});

type Syn = { id: string; customer_term: string; item_code: string };
type Inv = { item_code: string; item_name: string };
type Instr = { id: string; instructions: string };

// ---------------------------------------------------------------------------
// Searchable inventory picker — filters client-side, caps rendered nodes at 50.
// Rendering the full inventory (15k+) as SelectItems is what made the page lag.
// ---------------------------------------------------------------------------
const ItemPicker = memo(function ItemPicker({
  items,
  value,
  onChange,
  loading,
}: {
  items: Inv[];
  value: string;
  onChange: (v: string) => void;
  loading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  const selected = useMemo(
    () => items.find((i) => i.item_code === value) ?? null,
    [items, value],
  );

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return items.slice(0, 50);
    const out: Inv[] = [];
    for (const i of items) {
      if (
        i.item_name.toLowerCase().includes(term) ||
        i.item_code.toLowerCase().includes(term)
      ) {
        out.push(i);
        if (out.length >= 50) break;
      }
    }
    return out;
  }, [items, q]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          className="justify-between font-normal"
          disabled={loading}
        >
          <span className="truncate">
            {selected
              ? `${selected.item_name} (${selected.item_code})`
              : loading
                ? "Loading inventory…"
                : "Select internal item"}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[--radix-popover-trigger-width] min-w-[320px]" align="start">
        <div className="p-2 border-b">
          <Input
            autoFocus
            placeholder="Search by name or code…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-8"
          />
        </div>
        <div className="max-h-72 overflow-auto">
          {filtered.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">No matches.</div>
          ) : (
            filtered.map((i) => (
              <button
                key={i.item_code}
                type="button"
                onClick={() => {
                  onChange(i.item_code);
                  setOpen(false);
                  setQ("");
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
              >
                <Check
                  className={cn(
                    "h-4 w-4 shrink-0",
                    value === i.item_code ? "opacity-100" : "opacity-0",
                  )}
                />
                <span className="truncate">
                  {i.item_name}{" "}
                  <span className="text-xs text-muted-foreground font-mono">({i.item_code})</span>
                </span>
              </button>
            ))
          )}
          {q.trim() === "" && items.length > 50 && (
            <div className="px-3 py-2 text-xs text-muted-foreground border-t">
              Showing first 50 of {items.length.toLocaleString()} — type to filter.
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
});

// ---------------------------------------------------------------------------
// Global AI Instructions — isolated component so typing in the textarea does
// not re-render the synonym table or inventory picker above.
// ---------------------------------------------------------------------------
function GlobalAiInstructions() {
  const qc = useQueryClient();
  const instrQ = useQuery({
    queryKey: ["ai-instructions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_instructions")
        .select("id,instructions")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as Instr | null;
    },
  });
  const [instrText, setInstrText] = useState("");
  useEffect(() => {
    if (instrQ.data) setInstrText(instrQ.data.instructions ?? "");
  }, [instrQ.data]);

  const saveInstr = useMutation({
    mutationFn: async () => {
      if (instrQ.data?.id) {
        const { error } = await supabase
          .from("ai_instructions")
          .update({ instructions: instrText, updated_at: new Date().toISOString() })
          .eq("id", instrQ.data.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("ai_instructions").insert({ instructions: instrText });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("AI instructions saved");
      qc.invalidateQueries({ queryKey: ["ai-instructions"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <Card className="p-6 space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Global AI Instructions</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Free-form rules injected into the Gemini prompt every time a quotation image is processed.
        </p>
      </div>
      <Textarea
        value={instrText}
        onChange={(e) => setInstrText(e.target.value)}
        placeholder={`Example:
- If the customer writes "wire" without a size, assume 1.5 sqmm.
- Ignore any lines that contain the word "sample".
- Prefer Havells over Anchor when both match a switch item.`}
        className="min-h-[180px] font-mono text-sm"
        disabled={instrQ.isLoading}
      />
      <div className="flex justify-end">
        <Button onClick={() => saveInstr.mutate()} disabled={saveInstr.isPending}>
          <Save className="h-4 w-4 mr-2" />
          {saveInstr.isPending ? "Saving…" : "Save Instructions"}
        </Button>
      </div>
    </Card>
  );
}

function SynonymsPage() {
  const qc = useQueryClient();
  const [term, setTerm] = useState("");
  const [code, setCode] = useState("");

  const synQ = useQuery({
    queryKey: ["synonyms"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("synonyms")
        .select("*")
        .order("customer_term");
      if (error) throw error;
      return (data ?? []) as Syn[];
    },
  });
  const invQ = useQuery({
    queryKey: ["inventory"],
    queryFn: async () =>
      fetchAllRows<Inv>("inventory", "item_code,item_name,category,brand"),
  });

  const add = useMutation({
    mutationFn: async () => {
      if (!term.trim() || !code) throw new Error("Both fields required");
      const { error } = await supabase
        .from("synonyms")
        .insert({ customer_term: term.trim(), item_code: code });
      if (error) throw error;
    },
    onSuccess: () => {
      setTerm("");
      setCode("");
      qc.invalidateQueries({ queryKey: ["synonyms"] });
      toast.success("Synonym added");
    },
    onError: (e) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("synonyms").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["synonyms"] }),
  });

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Synonym Mapping</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Hard rules. When the customer writes the term on the left, always match to the item on the right.
        </p>
      </div>

      <Card className="p-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3">
          <Input
            placeholder='Customer term, e.g. "Finolex 1.5"'
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
          <ItemPicker
            items={invQ.data ?? []}
            value={code}
            onChange={setCode}
            loading={invQ.isLoading}
          />
          <Button onClick={() => add.mutate()} disabled={add.isPending}>
            <Plus className="h-4 w-4 mr-2" /> Add
          </Button>
        </div>

        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left p-3 font-medium">Customer Term</th>
                <th className="text-left p-3 font-medium">→ Item Code</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody>
              {(synQ.data ?? []).length === 0 && (
                <tr>
                  <td colSpan={3} className="p-6 text-center text-muted-foreground">
                    No synonyms yet.
                  </td>
                </tr>
              )}
              {(synQ.data ?? []).map((s) => (
                <tr key={s.id} className="border-t">
                  <td className="p-3">{s.customer_term}</td>
                  <td className="p-3 font-mono text-xs">{s.item_code}</td>
                  <td className="p-3">
                    <button
                      onClick={() => del.mutate(s.id)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <GlobalAiInstructions />
    </div>
  );
}
