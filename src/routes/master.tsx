import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload, Trash2, Download, Search, Pencil, Check, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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

type Draft = {
  item_name: string;
  category: string;
  retail_price: string;
  contractor_price: string;
  wholesale_price: string;
};

const REQUIRED = ["item_code", "item_name", "category", "retail_price", "contractor_price", "wholesale_price"];

function MasterPage() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState("");
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

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

  const updateRow = useMutation({
    mutationFn: async (payload: { item_code: string; patch: Partial<Inv> }) => {
      const { error } = await supabase
        .from("inventory")
        .update(payload.patch)
        .eq("item_code", payload.item_code);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inventory"] });
      qc.invalidateQueries({ queryKey: ["inventory-min"] });
      toast.success("Item updated");
      setEditingCode(null);
      setDraft(null);
      setConfirmOpen(false);
    },
    onError: (e) => toast.error((e as Error).message),
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

  const startEdit = (r: Inv) => {
    setEditingCode(r.item_code);
    setDraft({
      item_name: r.item_name,
      category: r.category ?? "",
      retail_price: String(r.retail_price),
      contractor_price: String(r.contractor_price),
      wholesale_price: String(r.wholesale_price),
    });
  };

  const cancelEdit = () => {
    setEditingCode(null);
    setDraft(null);
  };

  const requestSave = () => {
    if (!draft) return;
    if (!draft.item_name.trim()) {
      toast.error("Item name is required");
      return;
    }
    for (const k of ["retail_price", "contractor_price", "wholesale_price"] as const) {
      const n = Number(draft[k]);
      if (!Number.isFinite(n) || n < 0) {
        toast.error(`${k.replace("_", " ")} must be a number ≥ 0`);
        return;
      }
    }
    setConfirmOpen(true);
  };

  const editingOriginal = useMemo(
    () => (invQ.data ?? []).find((r) => r.item_code === editingCode) ?? null,
    [invQ.data, editingCode],
  );

  const diff = useMemo(() => {
    if (!editingOriginal || !draft) return [] as { field: string; old: string; next: string }[];
    const next = {
      item_name: draft.item_name.trim(),
      category: draft.category.trim(),
      retail_price: Number(draft.retail_price),
      contractor_price: Number(draft.contractor_price),
      wholesale_price: Number(draft.wholesale_price),
    };
    const out: { field: string; old: string; next: string }[] = [];
    if (next.item_name !== editingOriginal.item_name) out.push({ field: "Name", old: editingOriginal.item_name, next: next.item_name });
    if (next.category !== (editingOriginal.category ?? "")) out.push({ field: "Category", old: editingOriginal.category ?? "—", next: next.category || "—" });
    if (next.retail_price !== Number(editingOriginal.retail_price)) out.push({ field: "Retail", old: `₹${Number(editingOriginal.retail_price).toFixed(2)}`, next: `₹${next.retail_price.toFixed(2)}` });
    if (next.contractor_price !== Number(editingOriginal.contractor_price)) out.push({ field: "Contractor", old: `₹${Number(editingOriginal.contractor_price).toFixed(2)}`, next: `₹${next.contractor_price.toFixed(2)}` });
    if (next.wholesale_price !== Number(editingOriginal.wholesale_price)) out.push({ field: "Wholesale", old: `₹${Number(editingOriginal.wholesale_price).toFixed(2)}`, next: `₹${next.wholesale_price.toFixed(2)}` });
    return out;
  }, [editingOriginal, draft]);

  const confirmSave = () => {
    if (!editingOriginal || !draft) return;
    if (diff.length === 0) {
      toast.info("No changes to save");
      setConfirmOpen(false);
      setEditingCode(null);
      setDraft(null);
      return;
    }
    updateRow.mutate({
      item_code: editingOriginal.item_code,
      patch: {
        item_name: draft.item_name.trim(),
        category: draft.category.trim() || null,
        retail_price: Number(draft.retail_price),
        contractor_price: Number(draft.contractor_price),
        wholesale_price: Number(draft.wholesale_price),
      },
    });
  };

  const all = invQ.data ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (r) =>
        r.item_code.toLowerCase().includes(q) ||
        r.item_name.toLowerCase().includes(q) ||
        (r.category ?? "").toLowerCase().includes(q),
    );
  }, [all, search]);

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
          {all.length > 0 && (
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

        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by code, name, or category…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>
          {search && (
            <Button variant="ghost" size="sm" onClick={() => setSearch("")}>
              Clear
            </Button>
          )}
          <span className="text-xs text-muted-foreground ml-auto">
            {search ? `${filtered.length} of ${all.length}` : `${all.length} items`}
          </span>
        </div>

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
                <th className="text-right p-3 font-medium w-24">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-muted-foreground">
                    {all.length === 0 ? "No inventory loaded." : "No items match your search."}
                  </td>
                </tr>
              )}
              {filtered.map((r) => {
                const isEditing = editingCode === r.item_code && draft;
                return (
                  <tr key={r.item_code} className="border-t">
                    <td className="p-3 font-mono text-xs">{r.item_code}</td>
                    <td className="p-3">
                      {isEditing ? (
                        <Input
                          value={draft!.item_name}
                          onChange={(e) => setDraft({ ...draft!, item_name: e.target.value })}
                          className="h-8"
                        />
                      ) : (
                        r.item_name
                      )}
                    </td>
                    <td className="p-3 text-muted-foreground">
                      {isEditing ? (
                        <Input
                          value={draft!.category}
                          onChange={(e) => setDraft({ ...draft!, category: e.target.value })}
                          className="h-8"
                        />
                      ) : (
                        r.category ?? "—"
                      )}
                    </td>
                    {(["retail_price", "contractor_price", "wholesale_price"] as const).map((k) => (
                      <td key={k} className="p-3 text-right">
                        {isEditing ? (
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            value={draft![k]}
                            onChange={(e) => setDraft({ ...draft!, [k]: e.target.value })}
                            className="h-8 text-right"
                          />
                        ) : (
                          `₹${Number(r[k]).toFixed(2)}`
                        )}
                      </td>
                    ))}
                    <td className="p-3 text-right">
                      <div className="inline-flex gap-1">
                        {isEditing ? (
                          <>
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={requestSave} title="Save">
                              <Check className="h-4 w-4" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={cancelEdit} title="Cancel">
                              <X className="h-4 w-4" />
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => startEdit(r)}
                            disabled={editingCode !== null}
                            title="Edit"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
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

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm changes</AlertDialogTitle>
            <AlertDialogDescription>
              {editingOriginal ? (
                <>
                  Review changes to <span className="font-mono">{editingOriginal.item_code}</span> before saving.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {diff.length === 0 ? (
            <p className="text-sm text-muted-foreground">No fields were changed.</p>
          ) : (
            <div className="border rounded-md overflow-hidden text-sm">
              <table className="w-full">
                <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="text-left p-2 font-medium">Field</th>
                    <th className="text-left p-2 font-medium">Old</th>
                    <th className="text-left p-2 font-medium">New</th>
                  </tr>
                </thead>
                <tbody>
                  {diff.map((d) => (
                    <tr key={d.field} className="border-t">
                      <td className="p-2 font-medium">{d.field}</td>
                      <td className="p-2 text-muted-foreground line-through">{d.old}</td>
                      <td className="p-2 text-primary font-medium">{d.next}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={updateRow.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmSave} disabled={updateRow.isPending || diff.length === 0}>
              {updateRow.isPending ? "Saving…" : "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
