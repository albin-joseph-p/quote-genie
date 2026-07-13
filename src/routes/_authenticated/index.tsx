import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Upload,
  Loader2,
  FileDown,
  Copy,
  CheckCircle2,
  Pencil,
  Trash2,
  X,
  Check,
  ChevronsUpDown,
  Filter,
  Save,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { supabase } from "@/integrations/supabase/client";
import { processQuotation } from "@/lib/quote.functions";
import { cn } from "@/lib/utils";
import { fetchAllRows } from "@/lib/fetch-all";

type InventoryRow = {
  item_code: string;
  item_name: string;
  category: string | null;
  brand: string;
};

type Row = {
  id: string;
  extractedText: string;
  itemCode: string | null;
  category: string | null;
  qty: number;
  aiItemCode: string | null; // original AI pick (for "edited" highlight)
};


export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "Quotation Workspace — Orion Sales Corporation" },
      { name: "description", content: "Upload customer quote images, classify by category, lock per-category brand, and export." },
    ],
  }),
  component: Workspace,
});

function Workspace() {
  const process = useServerFn(processQuotation);
  const fileRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [previews, setPreviews] = useState<{ url: string; name: string }[]>([]);
  const [uploadedPaths, setUploadedPaths] = useState<string[]>([]);
  const [zoomed, setZoomed] = useState<{ url: string; name: string } | null>(null);
  const [customerName, setCustomerName] = useState("");
  // category name → selected brand name
  const [brandByCategory, setBrandByCategory] = useState<Record<string, string>>({});

  // Reopen from history
  useEffect(() => {
    const raw = sessionStorage.getItem("reuse-quotation");
    if (!raw) return;
    sessionStorage.removeItem("reuse-quotation");
    try {
      const parsed = JSON.parse(raw) as { customer_name?: string; items?: Array<{ extractedText: string; itemCode: string | null; category: string | null; qty: number }> };
      if (parsed.customer_name) setCustomerName(parsed.customer_name);
      const stamp = Date.now();
      setRows(
        (parsed.items ?? []).map((it, idx) => ({
          id: `reuse-${stamp}-${idx}`,
          extractedText: it.extractedText,
          itemCode: it.itemCode,
          category: it.category,
          qty: it.qty ?? 1,
          aiItemCode: it.itemCode,
        })),
      );
      toast.success("Loaded quotation from history");
    } catch (e) {
      console.error(e);
    }
  }, []);

  const inventoryQ = useQuery({
    queryKey: ["inventory"],
    queryFn: async () =>
      fetchAllRows<InventoryRow>("inventory", "item_code,item_name,category,brand"),
  });

  const inventory = inventoryQ.data ?? [];

  // Categories and brands are derived from Master Inventory so this workspace,
  // the Categories tab, and the AI prompt always share one source of truth.
  const { categories, brandsByCategory } = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const r of inventory) {
      const cat = (r.category ?? "").trim();
      if (!cat) continue;
      if (!map.has(cat)) map.set(cat, new Set());
      const brand = (r.brand ?? "").trim();
      if (brand) map.get(cat)!.add(brand);
    }
    const cats = Array.from(map.keys()).sort((a, b) => a.localeCompare(b));
    const brandsByCategory: Record<string, string[]> = {};
    for (const [c, set] of map.entries()) {
      brandsByCategory[c] = Array.from(set).sort((a, b) => a.localeCompare(b));
    }
    return { categories: cats, brandsByCategory };
  }, [inventory]);

  const invByCode = useMemo(() => new Map(inventory.map((i) => [i.item_code, i])), [inventory]);
  const categoryExists = useMemo(() => new Set(categories), [categories]);


  const MAX_IMAGES = 10;

  const fileToBase64 = async (file: File) => {
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  };

  const onFiles = async (fileList: File[]) => {
    const images = fileList.filter((f) => f.type.startsWith("image/"));
    const skipped = fileList.length - images.length;
    if (skipped > 0) toast.error(`${skipped} non-image file${skipped === 1 ? "" : "s"} skipped.`);
    if (images.length === 0) return;

    let batch = images;
    if (batch.length > MAX_IMAGES) {
      toast.error(`Only the first ${MAX_IMAGES} images will be processed.`);
      batch = batch.slice(0, MAX_IMAGES);
    }

    const newPreviews = batch.map((f) => ({ url: URL.createObjectURL(f), name: f.name }));
    setPreviews((p) => [...p, ...newPreviews]);

    setLoading(true);
    setProgress({ done: 0, total: batch.length });
    const batchStamp = Date.now();
    let succeeded = 0;
    let failed = 0;
    let extracted = 0;

    const results = await Promise.allSettled(
      batch.map(async (file, idx) => {
        const base64 = await fileToBase64(file);
        // Upload to storage in parallel with AI processing
        const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
        const path = `${batchStamp}/${idx}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const uploadP = supabase.storage
          .from("quotation-images")
          .upload(path, file, { contentType: file.type, upsert: false })
          .then((r) => (r.error ? null : path))
          .catch(() => null);
        const [res, storagePath] = await Promise.all([
          process({ data: { imageBase64: base64, mimeType: file.type } }),
          uploadP,
        ]);
        return { idx, items: res.items, storagePath, error: res.error };
      }),
    );

    const newPaths: string[] = [];
    for (const r of results) {
      if (r.status === "fulfilled") {
        const { idx, items, storagePath, error } = r.value;
        if (storagePath) newPaths.push(storagePath);
        if (error) {
          failed += 1;
          toast.error(`One image failed: ${error.message}`);
          setProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
          continue;
        }
        succeeded += 1;
        const newRows: Row[] = items.map((it, rIdx) => ({
          id: `${batchStamp}-${idx}-${rIdx}`,
          extractedText: it.extractedText,
          itemCode: it.itemCode,
          category: it.category ?? null,
          qty: it.customerQty ?? 1,
          aiItemCode: it.itemCode,
        }));
        extracted += newRows.length;
        setRows((rs) => [...rs, ...newRows]);
        setProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
      } else {
        failed += 1;
        console.error(r.reason);
        toast.error("One image failed: " + (r.reason as Error).message);
        setProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
      }
    }
    setUploadedPaths((prev) => [...prev, ...newPaths]);

    setLoading(false);
    setProgress(null);
    if (succeeded > 0) {
      toast.success(`Extracted ${extracted} item${extracted === 1 ? "" : "s"} from ${succeeded} of ${batch.length} image${batch.length === 1 ? "" : "s"}.`);
    } else if (failed > 0) {
      toast.error("No images were processed. Please wait a moment and try again.");
    }
  };

  const clearAll = () => {
    previews.forEach((p) => URL.revokeObjectURL(p.url));
    setPreviews([]);
    setRows([]);
    setBrandByCategory({});
    setUploadedPaths([]);
    setCustomerName("");
  };

  const saveToHistory = async () => {
    if (rows.length === 0) {
      toast.error("Nothing to save.");
      return;
    }
    setSaving(true);
    const items = rows.map((r) => ({
      extractedText: r.extractedText,
      itemCode: r.itemCode,
      category: r.category,
      qty: r.qty,
    }));
    const { error } = await supabase.from("quotations").insert({
      customer_name: customerName.trim(),
      image_urls: uploadedPaths,
      items,
      item_count: rows.length,
    });
    setSaving(false);
    if (error) {
      toast.error("Save failed: " + error.message);
      return;
    }
    toast.success("Saved to History");
  };

  // Categories detected across current rows
  const detectedCategories = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.category) set.add(r.category);
    return Array.from(set).sort();
  }, [rows]);

  // Extract size / dimension tokens (numbers, fractions, decimals) normalized
  // to decimal strings, so "2 1/2", "2-1/2", "2.5", "2½" all compare equal.
  const extractSizes = (text: string): Set<string> => {
    const s = text
      .toLowerCase()
      .replace(/½/g, " 1/2")
      .replace(/¼/g, " 1/4")
      .replace(/¾/g, " 3/4")
      .replace(/⅓/g, " 1/3")
      .replace(/⅔/g, " 2/3");
    const out = new Set<string>();
    // whole + fraction, e.g. "2 1/2" or "2-1/2"
    const mixed = s.matchAll(/(\d+)[\s-]+(\d+)\s*\/\s*(\d+)/g);
    for (const m of mixed) {
      const v = Number(m[1]) + Number(m[2]) / Number(m[3]);
      out.add(v.toFixed(2).replace(/\.?0+$/, ""));
    }
    // bare fractions
    const frac = s.replace(/(\d+)[\s-]+(\d+)\s*\/\s*(\d+)/g, " ").matchAll(/(\d+)\s*\/\s*(\d+)/g);
    for (const m of frac) {
      const v = Number(m[1]) / Number(m[2]);
      out.add(v.toFixed(2).replace(/\.?0+$/, ""));
    }
    // decimals and integers (avoid re-capturing fraction parts)
    const cleaned = s
      .replace(/(\d+)[\s-]+(\d+)\s*\/\s*(\d+)/g, " ")
      .replace(/(\d+)\s*\/\s*(\d+)/g, " ");
    const nums = cleaned.matchAll(/\d+(?:\.\d+)?/g);
    for (const m of nums) {
      const v = Number(m[0]);
      if (!Number.isFinite(v)) continue;
      out.add(v.toFixed(2).replace(/\.?0+$/, ""));
    }
    return out;
  };

  // Extract meaningful alphabetic "product-type" tokens (e.g. "plate", "modi",
  // "pipe", "socket") from the customer's extracted text. Strips digits, units,
  // and common noise so we can require the candidate item name to share at
  // least one of these — this preserves product-type intent when the user
  // switches brand (a "modi plate" must not become a "1 WAY 20A switch").
  const STOP_TOKENS = new Set([
    "the","and","for","with","pcs","pc","nos","no","qty","set","sets",
    "mm","cm","inch","in","sqmm","sq","core","class","way","ways","pin","pins",
    "amp","amps","watt","watts","volt","volts","kw","hp","meter","meters","mtr","mtrs",
    "size","type","new","old","big","small","large",
  ]);
  const typeTokens = (text: string): Set<string> => {
    const out = new Set<string>();
    for (const raw of text.toLowerCase().split(/[^a-z]+/)) {
      if (raw.length < 3) continue;
      if (STOP_TOKENS.has(raw)) continue;
      out.add(raw);
    }
    return out;
  };

  // Score with SIZE as a hard gate; token overlap only ranks size-compatible candidates.
  const score = (extracted: string, itemName: string) => {
    const A = extracted.toLowerCase();
    const B = itemName.toLowerCase();
    const sizesA = extractSizes(A);
    const sizesB = extractSizes(B);
    // If the extracted text has size tokens, the inventory name MUST share at least one.
    if (sizesA.size > 0) {
      let anyMatch = false;
      for (const s of sizesA) if (sizesB.has(s)) { anyMatch = true; break; }
      if (!anyMatch) return -1; // hard reject: wrong size
    }
    let s = 0;
    if (B.includes(A) || A.includes(B)) s += 50;
    const tokensA = new Set(A.split(/\W+/).filter(Boolean));
    const tokensB = new Set(B.split(/\W+/).filter(Boolean));
    for (const t of tokensA) if (tokensB.has(t)) s += 1;
    // Reward exact size overlap count
    for (const sz of sizesA) if (sizesB.has(sz)) s += 10;
    return s;
  };

  const applyBrandToCategory = (categoryName: string, brandName: string) => {
    setBrandByCategory((m) => ({ ...m, [categoryName]: brandName }));
    setRows((rs) =>
      rs.map((r) => {
        if (r.category !== categoryName) return r;
        const brandMatches = inventory.filter((i) => i.brand === brandName);
        if (brandMatches.length === 0) return { ...r, itemCode: null };
        const withCat = brandMatches.filter((i) => (i.category ?? "") === categoryName);
        let candidates = withCat.length > 0 ? withCat : brandMatches;
        // Preserve product-type intent: candidate must share ≥1 non-numeric
        // token with the customer's extracted text (e.g. "plate"). Also allow
        // the previously matched item's tokens so an AI match on "modi plate"
        // that resolved to "PLATE 1M ANCHOR GINA" still contributes "plate".
        const intent = typeTokens(r.extractedText);
        const prevInv = r.itemCode ? invByCode.get(r.itemCode) : undefined;
        if (prevInv) for (const t of typeTokens(prevInv.item_name)) intent.add(t);
        // Drop the newly chosen brand's own tokens so "elleys"/"gama" can't
        // stand in for a real product-type match.
        for (const t of typeTokens(brandName)) intent.delete(t);
        if (intent.size > 0) {
          const filtered = candidates.filter((c) => {
            const ct = typeTokens(c.item_name);
            for (const t of intent) if (ct.has(t)) return true;
            return false;
          });
          candidates = filtered;
        }
        if (candidates.length === 0) return { ...r, itemCode: null };
        let best: InventoryRow | null = null;
        let bestScore = 0;
        for (const c of candidates) {
          const s = score(r.extractedText, c.item_name);
          if (s > bestScore) {
            bestScore = s;
            best = c;
          }
        }
        // A wrong-size / wrong-type match is worse than no match — leave
        // itemCode null so the row is flagged and the user can override.
        return { ...r, itemCode: best ? best.item_code : null };
      }),
    );
  };

  const handleExportXlsx = async () => {
    const XLSX = await import("xlsx");
    const aoa = [
      ["Item Name", "Product ID", "Qty"],
      ...rows.map((r) => {
        const inv = r.itemCode ? invByCode.get(r.itemCode) : undefined;
        return [inv?.item_name ?? r.extractedText, inv?.item_code ?? "", r.qty];
      }),
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 48 }, { wch: 20 }, { wch: 8 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Quotation");
    XLSX.writeFile(wb, `quotation-${Date.now()}.xlsx`);
  };

  const handleCopy = async () => {
    const lines = [
      "Item Name\tProduct ID\tQty",
      ...rows.map((r) => {
        const inv = r.itemCode ? invByCode.get(r.itemCode) : undefined;
        return `${inv?.item_name ?? r.extractedText}\t${inv?.item_code ?? ""}\t${r.qty}`;
      }),
    ];
    await navigator.clipboard.writeText(lines.join("\n"));
    toast.success("Copied to clipboard.");
  };

  return (
    <div className="mx-auto max-w-7xl px-6 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Quotation Workspace</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Upload customer quote images. AI extracts items and classifies them into your categories.
        </p>
      </div>

      {/* Customer name */}
      <Card className="p-4">
        <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
          Customer Name
        </label>
        <Input
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
          placeholder="Whom is this quotation for?"
          className="max-w-md"
        />
      </Card>

      {/* Upload */}
      <Card className="p-6">
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const files = Array.from(e.dataTransfer.files ?? []);
            if (files.length) onFiles(files);
          }}
          onClick={() => fileRef.current?.click()}
          className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 hover:bg-accent/30 transition-colors"
        >
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length) onFiles(files);
              e.target.value = "";
            }}
          />
          {loading ? (
            <div className="flex flex-col items-center gap-3 text-primary">
              <Loader2 className="h-8 w-8 animate-spin" />
              <p className="text-sm font-medium">
                {progress
                  ? `Processing ${progress.done} / ${progress.total} image${progress.total === 1 ? "" : "s"}…`
                  : "Reading image and matching items…"}
              </p>
            </div>
          ) : previews.length > 0 ? (
            <div className="flex flex-col items-center gap-3">
              <div className="flex flex-wrap justify-center gap-2">
                {previews.map((p, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setZoomed(p);
                    }}
                    className="relative group"
                    title={`Click to zoom · ${p.name}`}
                  >
                    <img
                      src={p.url}
                      alt={p.name}
                      className="h-24 w-24 object-cover rounded border group-hover:ring-2 group-hover:ring-primary transition"
                    />
                  </button>
                ))}
              </div>
              <p className="text-sm text-muted-foreground">
                {previews.length} image{previews.length === 1 ? "" : "s"} uploaded · click or drop to add more (up to {MAX_IMAGES} per batch)
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 text-muted-foreground">
              <Upload className="h-10 w-10" />
              <div>
                <p className="font-medium text-foreground">Drop quotation images here</p>
                <p className="text-sm">or click to browse · JPEG, PNG · up to {MAX_IMAGES} at a time</p>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Category → Brand selector panel */}
      {detectedCategories.length > 0 && (
        <Card className="p-6 space-y-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Brand per Category
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              Choose a brand for each detected category. The selection applies to every matching row.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {detectedCategories.map((catName) => (
              <CategoryBrandRow
                key={catName}
                categoryName={catName}
                known={categoryExists.has(catName)}
                selectedBrand={brandByCategory[catName] ?? ""}
                brands={brandsByCategory[catName] ?? []}
                onSelectBrand={(brand) => applyBrandToCategory(catName, brand)}
              />
            ))}

          </div>
        </Card>
      )}

      {/* Results */}
      {rows.length > 0 && (
        <Card className="p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {rows.length} item{rows.length === 1 ? "" : "s"} · click a matched name to override
            </p>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={clearAll}>
                <X className="h-4 w-4 mr-2" /> Clear all
              </Button>
              <Button variant="outline" size="sm" onClick={saveToHistory} disabled={saving}>
                <Save className="h-4 w-4 mr-2" /> {saving ? "Saving…" : "Save to History"}
              </Button>
              <Button variant="outline" size="sm" onClick={handleCopy}>
                <Copy className="h-4 w-4 mr-2" /> Copy
              </Button>
              <Button size="sm" onClick={handleExportXlsx}>
                <FileDown className="h-4 w-4 mr-2" /> Export Excel
              </Button>
            </div>
          </div>

          <div className="border rounded-lg overflow-visible">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="text-left p-3 font-medium">Extracted Text</th>
                  <th className="text-left p-3 font-medium">Database Match</th>
                  <th className="text-left p-3 font-medium">Category</th>
                  <th className="text-left p-3 font-medium w-24">Qty</th>
                  <th className="text-left p-3 font-medium w-32">Status</th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const inv = r.itemCode ? invByCode.get(r.itemCode) : undefined;
                  const edited = r.itemCode !== r.aiItemCode;
                  return (
                    <tr
                      key={r.id}
                      className={cn("border-t align-top", edited && "bg-[var(--color-edited)]")}
                    >
                      <td className="p-3 text-muted-foreground">{r.extractedText}</td>
                      <td className="p-3">
                        <InventoryCombobox
                          inventory={inventory}
                          value={r.itemCode}
                          onChange={(code) =>
                            setRows((rs) =>
                              rs.map((x) => (x.id === r.id ? { ...x, itemCode: code } : x)),
                            )
                          }
                        />
                      </td>
                      <td className="p-3 text-muted-foreground">{r.category ?? "—"}</td>
                      <td className="p-3">
                        <Input
                          type="number"
                          min={1}
                          value={r.qty}
                          onChange={(e) =>
                            setRows((rs) =>
                              rs.map((x) =>
                                x.id === r.id ? { ...x, qty: Math.max(1, Number(e.target.value) || 1) } : x,
                              ),
                            )
                          }
                          className="h-9 w-20"
                        />
                      </td>
                      <td className="p-3">
                        {!r.itemCode ? (
                          <Badge variant="destructive">No match</Badge>
                        ) : edited ? (
                          <Badge className="bg-[var(--color-edited)] text-foreground border border-border">
                            <Pencil className="h-3 w-3 mr-1" /> Overridden
                          </Badge>
                        ) : (
                          <Badge variant="secondary">
                            <CheckCircle2 className="h-3 w-3 mr-1" /> AI match
                          </Badge>
                        )}
                        {inv && (
                          <p className="text-[10px] text-muted-foreground mt-1 font-mono">{inv.item_code}</p>
                        )}
                      </td>
                      <td className="p-3">
                        <button
                          onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Dialog open={!!zoomed} onOpenChange={(o) => !o && setZoomed(null)}>
        <DialogContent className="max-w-[95vw] w-fit p-2 sm:p-3">
          <DialogTitle className="sr-only">{zoomed?.name ?? "Image preview"}</DialogTitle>
          {zoomed && (
            <div className="overflow-auto max-h-[85vh]">
              <img
                src={zoomed.url}
                alt={zoomed.name}
                className="max-w-none h-auto"
                style={{ minWidth: "min(95vw, 1200px)" }}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CategoryBrandRow({
  categoryName,
  known,
  selectedBrand,
  brands,
  onSelectBrand,
}: {
  categoryName: string;
  known: boolean;
  selectedBrand: string;
  brands: string[];
  onSelectBrand: (brand: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex items-center gap-2 border rounded-md p-2 bg-background">
      <span className="text-sm font-medium px-2 min-w-[6rem]">{categoryName}</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="flex-1 justify-between h-9">
            <span className={selectedBrand ? "" : "text-muted-foreground"}>
              {selectedBrand || "Select brand…"}
            </span>
            <ChevronsUpDown className="h-3 w-3 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="end">
          <Command>
            <CommandInput placeholder="Search brands…" />
            <CommandList>
              <CommandEmpty>
                {known
                  ? "No brands found for this category in Master Inventory."
                  : "Category not present in Master Inventory."}
              </CommandEmpty>
              <CommandGroup>
                {brands.map((b) => (
                  <CommandItem
                    key={b}
                    value={b}
                    onSelect={() => {
                      onSelectBrand(b);
                      setOpen(false);
                    }}
                  >
                    <Check className={cn("h-3 w-3 mr-2", selectedBrand === b ? "opacity-100" : "opacity-0")} />
                    {b}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}


function InventoryCombobox({
  inventory,
  value,
  onChange,
}: {
  inventory: InventoryRow[];
  value: string | null;
  onChange: (code: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = value ? inventory.find((i) => i.item_code === value) : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          className="w-full justify-between h-9 font-normal"
        >
          <span className={cn("truncate", !selected && "text-muted-foreground")}>
            {selected ? selected.item_name : "— no match —"}
          </span>
          <ChevronsUpDown className="h-3 w-3 opacity-50 shrink-0 ml-2" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[420px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search by name, code, brand…" />
          <CommandList>
            <CommandEmpty>No items found.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__none"
                onSelect={() => {
                  onChange(null);
                  setOpen(false);
                }}
              >
                <span className="text-muted-foreground">— no match —</span>
              </CommandItem>
              {inventory.map((i) => (
                <CommandItem
                  key={i.item_code}
                  value={`${i.item_name} ${i.item_code} ${i.brand} ${i.category ?? ""}`}
                  onSelect={() => {
                    onChange(i.item_code);
                    setOpen(false);
                  }}
                >
                  <Check className={cn("h-3 w-3 mr-2", value === i.item_code ? "opacity-100" : "opacity-0")} />
                  <div className="flex-1 min-w-0">
                    <p className="truncate">{i.item_name}</p>
                    <p className="text-[10px] text-muted-foreground font-mono">
                      {i.item_code}
                      {i.brand ? ` · ${i.brand}` : ""}
                      {i.category ? ` · ${i.category}` : ""}
                    </p>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
