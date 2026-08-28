import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import * as XLSX from "xlsx";
import { FileSpreadsheet, ImageIcon, Loader2, Save, Sparkles, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { fileToBase64 } from "@/lib/image-mask";
import { compareSampleToInventory, type ComparisonRow } from "@/lib/quote-preset.functions";

export const Route = createFileRoute("/_authenticated/quote-presets")({
  head: () => ({
    meta: [
      { title: "Quotation Presets — Orion Sales Corporation" },
      {
        name: "description",
        content:
          "Upload a sample quotation image and a sample Excel output sheet, then generate a comparison list matching the image to master inventory products.",
      },
      { property: "og:title", content: "Quotation Presets — Orion Sales Corporation" },
      {
        property: "og:description",
        content: "Train quotation extraction with a sample image and the desired Excel output format.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: QuotePresetsPage,
});

type PresetRow = {
  id: string;
  name: string;
  sample_path: string;
  sample_mime: string;
  sample_paths?: string[] | null;
  sample_mimes?: string[] | null;
  excel_path: string;
  excel_name: string;
  excel_layout: string;
  notes: string;
  is_active: boolean;
  created_at: string;
};

type Draft = {
  id: string | null;
  name: string;
  notes: string;
  is_active: boolean;
  sample_path: string;
  sample_mime: string;
  sample_paths: string[];
  sample_mimes: string[];
  excel_path: string;
  excel_name: string;
  excel_layout: string;
};

const emptyDraft = (): Draft => ({
  id: null,
  name: "",
  notes: "",
  is_active: true,
  sample_path: "",
  sample_mime: "",
  sample_paths: [],
  sample_mimes: [],
  excel_path: "",
  excel_name: "",
  excel_layout: "",
});

/** Reads the sheet into a compact text table so the AI can learn the layout. */
async function excelToLayoutText(file: File) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const parts: string[] = [];
  for (const sheetName of wb.SheetNames.slice(0, 3)) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], {
      header: 1,
      blankrows: false,
      defval: "",
    });
    const body = rows
      .slice(0, 60)
      .map((r) => (r as unknown[]).map((c) => String(c ?? "").trim()).join(" | "))
      .filter((l) => l.replace(/[|\s]/g, "").length > 0);
    parts.push(`Sheet "${sheetName}":\n${body.join("\n")}`);
  }
  return parts.join("\n\n").slice(0, 8000);
}

const confidenceVariant = (c: ComparisonRow["confidence"]) =>
  c === "high" ? "default" : c === "medium" ? "secondary" : "outline";

function QuotePresetsPage() {
  const imageRef = useRef<HTMLInputElement>(null);
  const excelRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [sampleFiles, setSampleFiles] = useState<Record<string, File>>({});
  const [samplePreviews, setSamplePreviews] = useState<Record<string, string>>({});
  const [signed, setSigned] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState<"image" | "excel" | null>(null);
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [rows, setRows] = useState<ComparisonRow[]>([]);
  const [sortKey, setSortKey] = useState<"none" | "category" | "confidence" | "text">("none");

  const compare = useServerFn(compareSampleToInventory);

  const { data: presets = [], refetch, isLoading } = useQuery({
    queryKey: ["quotation-presets"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quotation_presets")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as PresetRow[];
    },
  });

  const signFor = async (paths: string[]) => {
    const missing = paths.filter((p) => p && !signed[p]);
    if (!missing.length) return;
    const { data } = await supabase.storage.from("quotation-images").createSignedUrls(missing, 3600);
    const next: Record<string, string> = {};
    (data ?? []).forEach((d, i) => {
      if (d.signedUrl) next[missing[i]] = d.signedUrl;
    });
    if (Object.keys(next).length) setSigned((s) => ({ ...s, ...next }));
  };

  const onPickImages = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading("image");
    try {
      const stamp = Date.now();
      for (const [i, file] of Array.from(files).entries()) {
        const path = `quote-presets/input/${stamp}-${i}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        const mime = file.type || "image/jpeg";
        const up = await supabase.storage.from("quotation-images").upload(path, file, {
          contentType: mime,
          upsert: false,
        });
        if (up.error) throw up.error;
        setSampleFiles((s) => ({ ...s, [up.data.path]: file }));
        if (mime.startsWith("image/")) {
          setSamplePreviews((s) => ({ ...s, [up.data.path]: URL.createObjectURL(file) }));
        }
        setDraft((d) => ({
          ...d,
          sample_paths: [...d.sample_paths, up.data.path],
          sample_mimes: [...d.sample_mimes, mime],
          sample_path: d.sample_path || up.data.path,
          sample_mime: d.sample_mime || mime,
        }));
        await signFor([up.data.path]);
      }
      setRows([]);
      toast.success(files.length > 1 ? `${files.length} sample images uploaded` : "Sample input uploaded");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(null);
      if (imageRef.current) imageRef.current.value = "";
    }
  };

  const removeSampleAt = (idx: number) => {
    let removed = "";
    setDraft((d) => {
      removed = d.sample_paths[idx] ?? "";
      const paths = d.sample_paths.filter((_, i) => i !== idx);
      const mimes = d.sample_mimes.filter((_, i) => i !== idx);
      return { ...d, sample_paths: paths, sample_mimes: mimes, sample_path: paths[0] ?? "", sample_mime: mimes[0] ?? "" };
    });
    if (removed) {
      setSampleFiles((s) => {
        const next = { ...s };
        delete next[removed];
        return next;
      });
    }
    setRows([]);
  };

  const onPickExcel = async (file: File | undefined) => {
    if (!file) return;
    setUploading("excel");
    try {
      const layout = await excelToLayoutText(file);
      const path = `quote-presets/output/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const up = await supabase.storage.from("quotation-images").upload(path, file, {
        contentType: file.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        upsert: false,
      });
      if (up.error) throw up.error;
      setDraft((d) => ({ ...d, excel_path: up.data.path, excel_name: file.name, excel_layout: layout }));
      await signFor([up.data.path]);
      toast.success("Sample output sheet read");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Could not read the sheet");
    } finally {
      setUploading(null);
      if (excelRef.current) excelRef.current.value = "";
    }
  };

  const analyze = async () => {
    const paths = draft.sample_paths.length ? draft.sample_paths : draft.sample_path ? [draft.sample_path] : [];
    if (!paths.length) return toast.error("Upload at least one sample input image first.");
    setAnalyzing(true);
    try {
      const mimes = draft.sample_paths.length
        ? draft.sample_mimes
        : [draft.sample_mime || "image/jpeg"];
      const merged: ComparisonRow[] = [];
      let firstError: string | null = null;
      for (const [i, path] of paths.entries()) {
        let base64: string;
        const mime = mimes[i] || "image/jpeg";
        const local = sampleFiles[path];
        if (local) {
          base64 = await fileToBase64(local);
        } else {
          const { data: dl, error: dlErr } = await supabase.storage.from("quotation-images").download(path);
          if (dlErr) throw dlErr;
          base64 = await fileToBase64(new File([dl], path.split("/").pop() ?? "sample", { type: mime }));
        }
        const res = await compare({
          data: { imageBase64: base64, mimeType: mime, excelLayout: draft.excel_layout },
        });
        if (res.error) {
          firstError = res.error;
          continue;
        }
        merged.push(...res.rows);
      }
      setRows(merged);
      if (!merged.length) toast.error(firstError ?? "No line items could be read from the samples.");
      else toast.success(`${merged.length} line(s) compared from ${paths.length} image(s)`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Comparison failed");
    } finally {
      setAnalyzing(false);
    }
  };

  const save = async () => {
    if (!draft.name.trim()) return toast.error("Give the preset a name.");
    if (!draft.sample_paths.length && !draft.sample_path)
      return toast.error("Upload at least one sample input image.");
    if (!draft.excel_path) return toast.error("Upload a sample Excel output sheet.");
    const paths = draft.sample_paths.length ? draft.sample_paths : [draft.sample_path];
    const mimes = draft.sample_paths.length ? draft.sample_mimes : [draft.sample_mime];
    setSaving(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const payload = {
        name: draft.name.trim(),
        notes: draft.notes,
        is_active: draft.is_active,
        sample_path: paths[0],
        sample_mime: mimes[0] ?? "image/jpeg",
        sample_paths: paths,
        sample_mimes: mimes,
        excel_path: draft.excel_path,
        excel_name: draft.excel_name,
        excel_layout: draft.excel_layout,
        created_by: userData.user?.id ?? null,
      };
      const res = draft.id
        ? await supabase.from("quotation_presets").update(payload).eq("id", draft.id)
        : await supabase.from("quotation_presets").insert(payload);
      if (res.error) throw res.error;
      toast.success(draft.id ? "Preset updated" : "Preset saved");
      setDraft(emptyDraft());
      setSampleFiles({});
      setSamplePreviews({});
      setRows([]);
      refetch();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to save preset");
    } finally {
      setSaving(false);
    }
  };

  const edit = async (p: PresetRow) => {
    const paths = p.sample_paths?.length ? p.sample_paths : p.sample_path ? [p.sample_path] : [];
    const mimes = p.sample_mimes?.length ? p.sample_mimes : p.sample_mime ? [p.sample_mime] : [];
    setDraft({
      id: p.id,
      name: p.name,
      notes: p.notes,
      is_active: p.is_active,
      sample_path: paths[0] ?? "",
      sample_mime: mimes[0] ?? "",
      sample_paths: paths,
      sample_mimes: mimes,
      excel_path: p.excel_path,
      excel_name: p.excel_name,
      excel_layout: p.excel_layout,
    });
    setSampleFiles({});
    setSamplePreviews({});
    setRows([]);
    await signFor([...paths, p.excel_path]);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("quotation_presets").delete().eq("id", id);
    if (error) return toast.error(error.message);
    if (draft.id === id) setDraft(emptyDraft());
    toast.success("Preset deleted");
    refetch();
  };

  const sortedRows = (() => {
    if (sortKey === "none") return rows;
    const order = { high: 0, medium: 1, low: 2, none: 3 } as const;
    return [...rows].sort((a, b) => {
      if (sortKey === "confidence") return order[a.confidence] - order[b.confidence];
      if (sortKey === "category") return (a.category ?? "~").localeCompare(b.category ?? "~");
      return a.extractedText.localeCompare(b.extractedText);
    });
  })();

  const exportComparison = () => {
    if (!rows.length) return;
    const ws = XLSX.utils.json_to_sheet(
      sortedRows.map((r) => ({
        "Customer line": r.extractedText,
        Qty: r.customerQty ?? "",
        "Item code": r.itemCode ?? "",
        "Item name": r.itemName ?? "",
        Category: r.category ?? "",
        Brand: r.brand ?? "",
        Confidence: r.confidence,
        Note: r.note ?? "",
      })),
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Comparison");
    XLSX.writeFile(wb, "comparison-list.xlsx");
  };

  const sampleList: { path: string; mime: string; src: string }[] = (
    draft.sample_paths.length ? draft.sample_paths : draft.sample_path ? [draft.sample_path] : []
  ).map((p, i) => ({
    path: p,
    mime: draft.sample_paths.length ? draft.sample_mimes[i] ?? "image/jpeg" : draft.sample_mime || "image/jpeg",
    src: samplePreviews[p] || signed[p] || "",
  }));

  return (
    <div className="mx-auto max-w-7xl px-6 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Quotation Presets</h1>
        <p className="text-sm text-muted-foreground">
          Upload a sample quotation image and a sample Excel sheet showing the output format you want, then generate a
          comparison list that matches the image against the master inventory.
        </p>
      </div>

      <Card className="p-5 space-y-6">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-1 md:col-span-2">
            <label className="text-xs font-medium text-muted-foreground">Preset name</label>
            <Input
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="e.g. Handwritten plumbing list — standard layout"
            />
          </div>
          <div className="flex items-end gap-2 pb-1">
            <Switch
              checked={draft.is_active}
              onCheckedChange={(v) => setDraft((d) => ({ ...d, is_active: v }))}
              aria-label="Active"
            />
            <span className="text-sm text-muted-foreground">Active</span>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {/* Sample input images */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <ImageIcon className="h-4 w-4" /> Sample input images
            </h2>
            <input
              ref={imageRef}
              type="file"
              multiple
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(e) => onPickImages(e.target.files)}
            />
            {sampleList.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {sampleList.map((s, idx) => (
                  <div key={s.path} className="relative overflow-hidden rounded-md border bg-muted">
                    {s.src && s.mime.startsWith("image/") ? (
                      <img src={s.src} alt={`Sample input ${idx + 1}`} className="h-24 w-full object-cover" />
                    ) : (
                      <div className="flex h-24 w-full flex-col items-center justify-center gap-1 text-[10px] text-muted-foreground">
                        <ImageIcon className="h-4 w-4" />
                        <span className="max-w-full truncate px-1">{s.path.split("/").pop()}</span>
                      </div>
                    )}
                    <button
                      onClick={() => removeSampleAt(idx)}
                      className="absolute right-1 top-1 rounded bg-background/90 p-0.5"
                      aria-label={`Remove sample image ${idx + 1}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => imageRef.current?.click()}
                  className="flex h-24 w-full flex-col items-center justify-center gap-1 rounded-md border border-dashed text-xs text-muted-foreground hover:bg-accent"
                >
                  {uploading === "image" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  Add more
                </button>
              </div>
            )}
            {sampleList.length === 0 && (
              <button
                onClick={() => imageRef.current?.click()}
                className="flex h-40 w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed text-sm text-muted-foreground hover:bg-accent"
              >
                {uploading === "image" ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Upload className="h-5 w-5" />
                )}
                Upload sample quotation images (you can pick several)
              </button>
            )}
          </section>

          {/* Sample Excel output */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4" /> Sample Excel output format
            </h2>
            <input
              ref={excelRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => onPickExcel(e.target.files?.[0])}
            />
            <button
              onClick={() => excelRef.current?.click()}
              className="flex h-40 w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed text-sm text-muted-foreground hover:bg-accent"
            >
              {uploading === "excel" ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <FileSpreadsheet className="h-5 w-5" />
              )}
              {draft.excel_name || "Upload sample .xlsx / .csv output"}
            </button>
            {draft.excel_layout && (
              <pre className="max-h-32 overflow-auto rounded-md border bg-muted/50 p-2 text-[11px] leading-4">
                {draft.excel_layout.slice(0, 1200)}
              </pre>
            )}
          </section>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Notes for the AI (optional)</label>
          <Textarea
            rows={3}
            value={draft.notes}
            onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
            placeholder="e.g. Quantities are written to the right of a dash. Group items by brand heading."
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={analyze} disabled={analyzing || !sampleList.length}>
            {analyzing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Sparkles className="h-4 w-4 mr-1" />}
            Generate comparison list
          </Button>
          <Button variant="outline" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
            {draft.id ? "Update preset" : "Save preset"}
          </Button>
          {draft.id && (
            <Button variant="ghost" onClick={() => setDraft(emptyDraft())}>
              Cancel edit
            </Button>
          )}
        </div>
      </Card>

      {rows.length > 0 && (
        <Card className="p-5 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">Comparison list ({rows.length})</h2>
            <div className="ml-auto flex items-center gap-2">
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as typeof sortKey)}
                className="h-9 rounded-md border bg-background px-2 text-sm"
                aria-label="Sort comparison list"
              >
                <option value="none">Document order</option>
                <option value="confidence">Sort by confidence</option>
                <option value="category">Sort by category</option>
                <option value="text">Sort by customer line</option>
              </select>
              <Button variant="outline" size="sm" onClick={exportComparison}>
                Export Excel
              </Button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3">Customer line</th>
                  <th className="py-2 pr-3">Qty</th>
                  <th className="py-2 pr-3">Item code</th>
                  <th className="py-2 pr-3">Matched product</th>
                  <th className="py-2 pr-3">Category</th>
                  <th className="py-2 pr-3">Brand</th>
                  <th className="py-2 pr-3">Match</th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((r, i) => (
                  <tr key={`${r.extractedText}-${i}`} className="border-b last:border-0 align-top">
                    <td className="py-2 pr-3">{r.extractedText}</td>
                    <td className="py-2 pr-3">{r.customerQty ?? "—"}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{r.itemCode ?? "—"}</td>
                    <td className="py-2 pr-3">
                      {r.itemName ?? <span className="text-muted-foreground">No match</span>}
                      {r.note && <div className="text-xs text-muted-foreground">{r.note}</div>}
                    </td>
                    <td className="py-2 pr-3">{r.category ?? "—"}</td>
                    <td className="py-2 pr-3">{r.brand ?? "—"}</td>
                    <td className="py-2 pr-3">
                      <Badge variant={confidenceVariant(r.confidence)}>{r.confidence}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card className="p-5">
        <h2 className="text-sm font-semibold mb-3">Saved presets</h2>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : presets.length === 0 ? (
          <p className="text-sm text-muted-foreground">No presets yet. Create one above.</p>
        ) : (
          <div className="divide-y">
            {presets.map((p) => (
              <div key={p.id} className="flex items-center gap-3 py-3">
                <div className="min-w-0">
                  <div className="font-medium truncate">{p.name}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {p.excel_name || "no sheet"} · {p.sample_path ? "1 sample image" : "no image"}
                  </div>
                </div>
                {!p.is_active && <Badge variant="secondary">Inactive</Badge>}
                <div className="ml-auto flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => edit(p)}>
                    Edit
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => remove(p.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
