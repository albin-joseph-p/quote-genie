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
import { fetchAllRows } from "@/lib/fetch-all";

export const Route = createFileRoute("/master")({
  head: () => ({
    meta: [
      { title: "Master Inventory — Orion Sales Corporation" },
      { name: "description", content: "Upload your master inventory CSV/XLSX." },
    ],
  }),
  component: MasterPage,
});

type Inv = {
  item_code: string;
  item_name: string;
  category: string | null;
  brand: string;
};

type Draft = { item_name: string };

const REQUIRED = ["item_code", "item_name"];

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
    queryFn: async () =>
      fetchAllRows<Inv>("inventory", "item_code,item_name,category,brand"),
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
    mutationFn: async (payload: { item_code: string; patch: { item_name: string } }) => {
      const { error } = await supabase
        .from("inventory")
        .update(payload.patch)
        .eq("item_code", payload.item_code);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inventory"] });
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
          brand: String(r.brand ?? "").trim(),
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

      // Auto-create any new categories found in the upload
      const cats = Array.from(new Set(deduped.map((r) => r.category).filter((c): c is string => !!c)));
      if (cats.length) {
        await supabase.from("categories").upsert(cats.map((name) => ({ name })), { onConflict: "name" });
      }

      qc.invalidateQueries({ queryKey: ["inventory"] });
      qc.invalidateQueries({ queryKey: ["categories"] });
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
      "item_code,item_name,category,brand\n" +
      "ELEC-FIN-15,1.5 sqmm Wire (90m),Wires,Finolex\n" +
      "ELEC-POL-15,1.5 sqmm Wire (90m),Wires,Polycab\n" +
      "SAN-JAQ-BSN,Basin Mixer,Plumbing,Jaquar\n";
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
    setDraft({ item_name: r.item_name });
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
    setConfirmOpen(true);
  };

  const editingOriginal = useMemo(
    () => (invQ.data ?? []).find((r) => r.item_code === editingCode) ?? null,
    [invQ.data, editingCode],
  );

  const diff = useMemo(() => {
    if (!editingOriginal || !draft) return [] as { field: string; old: string; next: string }[];
    const next = draft.item_name.trim();
    if (next === editingOriginal.item_name) return [];
    return [{ field: "Name", old: editingOriginal.item_name, next }];
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
      patch: { item_name: draft.item_name.trim() },
    });
  };

  const all = invQ.data ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (r) => r.item_code.toLowerCase().includes(q) || r.item_name.toLowerCase().includes(q),
    );
  }, [all, search]);

  return (
    <div className="mx-auto max-w-4xl px-6 py-8 space-y-6">
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
          Required: <code>item_code, item_name</code>. Optional: <code>category, brand</code> (drive the brand selector on the workspace).
        </p>

        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by code or name…"
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
                <th className="text-left p-3 font-medium w-48">Item Code</th>
                <th className="text-left p-3 font-medium">Item Name</th>
                <th className="text-right p-3 font-medium w-24">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={3} className="p-6 text-center text-muted-foreground">
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
                          onChange={(e) => setDraft({ item_name: e.target.value })}
                          className="h-8"
                        />
                      ) : (
                        r.item_name
                      )}
                    </td>
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
