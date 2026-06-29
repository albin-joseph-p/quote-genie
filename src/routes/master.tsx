import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload, Trash2, Download } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/master")({
  head: () => ({
    meta: [
      { title: "Master Inventory — QuickQuote" },
      { name: "description", content: "Upload your master inventory CSV/XLSX with item codes and tiered prices." },
    ],
  }),
  component: MasterPage,
});

type Inv = {
  item_code: string;
  item_name: string;
  category: string | null;
  retail_price: number;
  contractor_price: number;
  wholesale_price: number;
};

const REQUIRED = ["item_code", "item_name", "category", "retail_price", "contractor_price", "wholesale_price"];

function MasterPage() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const invQ = useQuery({
    queryKey: ["inventory"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory")
        .select("*")
        .order("item_name");
      if (error) throw error;
      return (data ?? []) as Inv[];
    },
  });

  const wipe = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("inventory").delete().neq("item_code", "__none__");
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inventory"] });
      toast.success("Inventory cleared");
    },
  });

  const parseFile = async (file: File): Promise<Record<string, unknown>[]> => {
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext === "csv") {
      const { default: Papa } = await import("papaparse");
      const text = await file.text();
      const res = Papa.parse(text, { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, "_") });
      return res.data as Record<string, unknown>[];
    }
    if (ext === "xlsx" || ext === "xls") {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
      return rows.map((r) => {
        const out: Record<string, unknown> = {};
        for (const k in r) out[k.trim().toLowerCase().replace(/\s+/g, "_")] = r[k];
        return out;
      });
    }
    throw new Error("Unsupported file format. Use CSV or XLSX.");
  };

  const onFile = async (file: File) => {
    setUploading(true);
    try {
      const rows = await parseFile(file);
      if (!rows.length) throw new Error("Empty file");
      const first = rows[0];
      const missing = REQUIRED.filter((c) => !(c in first));
      if (missing.length) throw new Error(`Missing columns: ${missing.join(", ")}`);

      const normalized = rows
        .map((r) => ({
          item_code: String(r.item_code ?? "").trim(),
          item_name: String(r.item_name ?? "").trim(),
          category: String(r.category ?? "").trim() || null,
          retail_price: Number(r.retail_price) || 0,
          contractor_price: Number(r.contractor_price) || 0,
          wholesale_price: Number(r.wholesale_price) || 0,
        }))
        .filter((r) => r.item_code && r.item_name);

      if (!normalized.length) throw new Error("No valid rows");

      const seen = new Set<string>();
      const deduped = normalized.filter((r) => {
        if (seen.has(r.item_code)) return false;
        seen.add(r.item_code);
        return true;
      });

      // overwrite: delete all then upsert in batches
      const del = await supabase.from("inventory").delete().neq("item_code", "__none__");
      if (del.error) throw del.error;

      const BATCH = 500;
      for (let i = 0; i < deduped.length; i += BATCH) {
        const chunk = deduped.slice(i, i + BATCH);
        const { error } = await supabase.from("inventory").upsert(chunk, { onConflict: "item_code" });
        if (error) throw error;
      }
      qc.invalidateQueries({ queryKey: ["inventory"] });
      qc.invalidateQueries({ queryKey: ["inventory-min"] });
      toast.success(`Imported ${deduped.length} items${deduped.length !== normalized.length ? ` (${normalized.length - deduped.length} duplicates skipped)` : ""}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const downloadTemplate = () => {
    const csv =
      "item_code,item_name,category,retail_price,contractor_price,wholesale_price\n" +
      "ELEC-FIN-15,Finolex 1.5 sqmm Wire (90m),Electrical,2400,2150,1980\n" +
      "SAN-JAQ-BSN,Jaquar Basin Mixer,Sanitary,4500,3900,3500\n";
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "master-inventory-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Master Inventory</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Upload a CSV or Excel file. Uploading will <strong>replace</strong> the entire inventory.
        </p>
      </div>

      <Card className="p-6 space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => fileRef.current?.click()} disabled={uploading}>
            <Upload className="h-4 w-4 mr-2" />
            {uploading ? "Uploading…" : "Upload CSV / XLSX"}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
            }}
          />
          <Button variant="outline" onClick={downloadTemplate}>
            <Download className="h-4 w-4 mr-2" /> Template
          </Button>
          {(invQ.data?.length ?? 0) > 0 && (
            <Button
              variant="outline"
              onClick={() => {
                if (confirm("Delete all inventory?")) wipe.mutate();
              }}
            >
              <Trash2 className="h-4 w-4 mr-2" /> Clear all
            </Button>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Required columns: <code>item_code, item_name, category, retail_price, contractor_price, wholesale_price</code>
        </p>

        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left p-3 font-medium">Code</th>
                <th className="text-left p-3 font-medium">Name</th>
                <th className="text-left p-3 font-medium">Category</th>
                <th className="text-right p-3 font-medium">Retail</th>
                <th className="text-right p-3 font-medium">Contractor</th>
                <th className="text-right p-3 font-medium">Wholesale</th>
              </tr>
            </thead>
            <tbody>
              {(invQ.data ?? []).length === 0 && (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-muted-foreground">
                    No inventory loaded.
                  </td>
                </tr>
              )}
              {(invQ.data ?? []).map((r) => (
                <tr key={r.item_code} className="border-t">
                  <td className="p-3 font-mono text-xs">{r.item_code}</td>
                  <td className="p-3">{r.item_name}</td>
                  <td className="p-3 text-muted-foreground">{r.category ?? "—"}</td>
                  <td className="p-3 text-right">₹{Number(r.retail_price).toFixed(2)}</td>
                  <td className="p-3 text-right">₹{Number(r.contractor_price).toFixed(2)}</td>
                  <td className="p-3 text-right">₹{Number(r.wholesale_price).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
