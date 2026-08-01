import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Check, X, Pencil } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";

export type MeasurementRule = {
  id: string;
  input_unit: string;
  mm_value: number;
};

/** Parses "3/4", "3/4\"", "0.75 in", "2 1/2" → numeric value (unit-agnostic). */
export function parseMeasurementValue(raw: string): number | null {
  const s = raw.trim().replace(/["”″]/g, "").replace(/\b(in|inch|inches|mm)\b/gi, "").trim();
  const mixed = s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  const dec = s.match(/^\d*\.?\d+$/);
  if (dec) return Number(s);
  return null;
}

export function MeasurementConversions() {
  const qc = useQueryClient();
  const [unit, setUnit] = useState("");
  const [mm, setMm] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editUnit, setEditUnit] = useState("");
  const [editMm, setEditMm] = useState("");

  const listQ = useQuery({
    queryKey: ["measurement-conversions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("measurement_conversions")
        .select("id,input_unit,mm_value")
        .order("input_unit");
      if (error) throw error;
      return (data ?? []) as MeasurementRule[];
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["measurement-conversions"] });

  const add = useMutation({
    mutationFn: async () => {
      const value = Number(mm);
      if (!unit.trim()) throw new Error("Input unit is required");
      if (!Number.isFinite(value) || value <= 0) throw new Error("Enter a valid MM value");
      const { error } = await supabase
        .from("measurement_conversions")
        .insert({ input_unit: unit.trim(), mm_value: value });
      if (error) throw error;
    },
    onSuccess: () => {
      setUnit("");
      setMm("");
      invalidate();
      toast.success("Conversion added");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const update = useMutation({
    mutationFn: async (id: string) => {
      const value = Number(editMm);
      if (!editUnit.trim()) throw new Error("Input unit is required");
      if (!Number.isFinite(value) || value <= 0) throw new Error("Enter a valid MM value");
      const { error } = await supabase
        .from("measurement_conversions")
        .update({ input_unit: editUnit.trim(), mm_value: value })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      setEditingId(null);
      invalidate();
      toast.success("Conversion updated");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("measurement_conversions").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast.success("Conversion deleted");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const rows = listQ.data ?? [];

  return (
    <Card className="p-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Measurement Conversions</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Map customer measurements (fractions or decimals) to your internal millimetre standard.
          These override raw mathematical conversion — e.g. 3/4&quot; → 20&nbsp;mm, not 19.05&nbsp;mm.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3">
        <Input
          placeholder='Input unit / description, e.g. 3/4"'
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
        />
        <Input
          type="number"
          step="any"
          placeholder="Standard MM value, e.g. 20"
          value={mm}
          onChange={(e) => setMm(e.target.value)}
        />
        <Button onClick={() => add.mutate()} disabled={add.isPending}>
          <Plus className="h-4 w-4 mr-2" /> Add
        </Button>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="text-left p-3 font-medium">Input Unit / Description</th>
              <th className="text-left p-3 font-medium">Parsed Value</th>
              <th className="text-left p-3 font-medium">Standard MM Value</th>
              <th className="w-24"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="p-6 text-center text-muted-foreground">
                  {listQ.isLoading ? "Loading…" : "No conversion rules yet."}
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const isEditing = editingId === r.id;
              const parsed = parseMeasurementValue(r.input_unit);
              return (
                <tr key={r.id} className="border-t">
                  <td className="p-3">
                    {isEditing ? (
                      <Input
                        value={editUnit}
                        onChange={(e) => setEditUnit(e.target.value)}
                        className="h-8"
                      />
                    ) : (
                      r.input_unit
                    )}
                  </td>
                  <td className="p-3 font-mono text-xs text-muted-foreground">
                    {parsed === null ? "—" : parsed}
                  </td>
                  <td className="p-3">
                    {isEditing ? (
                      <Input
                        type="number"
                        step="any"
                        value={editMm}
                        onChange={(e) => setEditMm(e.target.value)}
                        className="h-8"
                      />
                    ) : (
                      <span className="font-mono text-xs">{r.mm_value} mm</span>
                    )}
                  </td>
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      {isEditing ? (
                        <>
                          <button
                            onClick={() => update.mutate(r.id)}
                            className="text-muted-foreground hover:text-primary"
                            aria-label="Save"
                          >
                            <Check className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="text-muted-foreground hover:text-foreground"
                            aria-label="Cancel"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => {
                              setEditingId(r.id);
                              setEditUnit(r.input_unit);
                              setEditMm(String(r.mm_value));
                            }}
                            className="text-muted-foreground hover:text-primary"
                            aria-label="Edit"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => del.mutate(r.id)}
                            className="text-muted-foreground hover:text-destructive"
                            aria-label="Delete"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
