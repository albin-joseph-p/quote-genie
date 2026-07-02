import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Save } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetch-all";

export const Route = createFileRoute("/synonyms")({
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

  // ---- Global AI Instructions ----
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
    onError: (e) => toast.error(e.message),
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
          <Select value={code} onValueChange={setCode}>
            <SelectTrigger>
              <SelectValue placeholder="Select internal item" />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {(invQ.data ?? []).map((i) => (
                <SelectItem key={i.item_code} value={i.item_code}>
                  {i.item_name} ({i.item_code})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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

      <Card className="p-6 space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Global AI Instructions</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Free-form rules injected into the AI prompt every time a quotation image is processed.
            Use this for edge-case handling, parsing priorities, or general behavioral guidance.
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
    </div>
  );
}
