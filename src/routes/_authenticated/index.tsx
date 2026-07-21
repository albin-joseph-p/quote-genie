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
import { Dialog, DialogContent, DialogTitle, DialogHeader, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
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
import { AnnotationEditor, type Annotation } from "@/components/annotation-editor";
import { ZoomPanViewer } from "@/components/zoom-pan-viewer";

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
  // Categories the AI is allowed to match within. Mandatory before any upload.
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  // Files staged while the user picks categories on their first upload.
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);
  // Manual annotation flow state
  const [annotatePromptOpen, setAnnotatePromptOpen] = useState(false);
  const [annotatorOpen, setAnnotatorOpen] = useState(false);
  const [filesForAnnotator, setFilesForAnnotator] = useState<File[]>([]);
  const [annotationsForBatch, setAnnotationsForBatch] = useState<Record<number, Annotation[]>>({});
  const [categoriesForBatch, setCategoriesForBatch] = useState<string[]>([]);
  // Editing mode: when set, submitting the annotator replaces the given batch's
  // rows/previews/paths instead of appending a new batch.
  const [editingBatchStamp, setEditingBatchStamp] = useState<number | null>(null);
  // Track the last processed batch so the user can reopen the annotation editor.
  const [lastBatch, setLastBatch] = useState<{
    stamp: number;
    files: File[];
    cats: string[];
    annotations: Record<number, Annotation[]>;
    previewUrls: string[];
  } | null>(null);


  // Reopen from history
  useEffect(() => {
    const raw = sessionStorage.getItem("reuse-quotation");
    if (!raw) return;
    sessionStorage.removeItem("reuse-quotation");
    try {
      const parsed = JSON.parse(raw) as {
        customer_name?: string;
        items?: Array<{ extractedText: string; itemCode: string | null; category: string | null; qty: number }>;
        image_urls?: string[];
      };
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
      const paths = parsed.image_urls ?? [];
      if (paths.length > 0) {
        setUploadedPaths(paths);
        supabase.storage
          .from("quotation-images")
          .createSignedUrls(paths, 60 * 60)
          .then(({ data, error }) => {
            if (error || !data) return;
            const previewsFromHistory = data
              .map((d, i) => (d.signedUrl ? { url: d.signedUrl, name: paths[i].split("/").pop() ?? `image-${i}` } : null))
              .filter((x): x is { url: string; name: string } => x !== null);
            if (previewsFromHistory.length > 0) {
              setPreviews((p) => [...p, ...previewsFromHistory]);
            }
          });
      }
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

  const defaultsQ = useQuery({
    queryKey: ["category_defaults"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("category_defaults")
        .select("category,brand");
      if (error) throw error;
      return (data ?? []) as { category: string; brand: string }[];
    },
  });

  const defaultBrandByCategory = useMemo(() => {
    const m: Record<string, string> = {};
    for (const d of defaultsQ.data ?? []) m[d.category] = d.brand;
    return m;
  }, [defaultsQ.data]);

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

  // Physically black out "Exclude" annotation regions so the AI cannot read them,
  // regardless of how well it obeys the prompt. Returns { base64, mimeType }.
  const maskExcludedRegions = async (
    file: File,
    annotations: Annotation[],
  ): Promise<{ base64: string; mimeType: string }> => {
    const mime = file.type || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg");
    // PDFs (and any non-image) can't be canvas-masked; send bytes as-is.
    if (!mime.startsWith("image/")) {
      return { base64: await fileToBase64(file), mimeType: mime };
    }
    const excludes = annotations.filter((a) => a.label === "Exclude");
    if (excludes.length === 0) {
      return { base64: await fileToBase64(file), mimeType: mime };
    }
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = reject;
        i.src = url;
      });
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return { base64: await fileToBase64(file), mimeType: file.type };
      ctx.drawImage(img, 0, 0);
      ctx.fillStyle = "#000000";
      for (const a of excludes) {
        ctx.fillRect(
          Math.round(a.x * canvas.width),
          Math.round(a.y * canvas.height),
          Math.round(a.w * canvas.width),
          Math.round(a.h * canvas.height),
        );
      }
      const blob: Blob = await new Promise((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("canvas encode failed"))),
          "image/jpeg",
          0.92,
        ),
      );
      const buf = await blob.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = "";
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
      return { base64: btoa(binary), mimeType: "image/jpeg" };
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  const isSupported = (f: File) =>
    f.type.startsWith("image/") ||
    f.type === "application/pdf" ||
    f.name.toLowerCase().endsWith(".pdf");

  const onFiles = async (fileList: File[], categoriesOverride?: string[]) => {
    const supported = fileList.filter(isSupported);
    const skipped = fileList.length - supported.length;
    if (skipped > 0) toast.error(`${skipped} unsupported file${skipped === 1 ? "" : "s"} skipped.`);
    if (supported.length === 0) return;

    const cats = categoriesOverride ?? selectedCategories;
    if (cats.length === 0) {
      // Stage the files and prompt the user to pick categories first.
      setPendingFiles(supported.slice(0, MAX_IMAGES));
      setCategoryDialogOpen(true);
      return;
    }

    let batch = supported;
    if (batch.length > MAX_IMAGES) {
      toast.error(`Only the first ${MAX_IMAGES} files will be processed.`);
      batch = batch.slice(0, MAX_IMAGES);
    }

    // PDFs can't be annotated in the image editor — if the batch is PDF-only,
    // skip the annotate prompt and process directly.
    const hasImage = batch.some((f) => f.type.startsWith("image/"));
    if (!hasImage) {
      runProcessing(batch, cats, {});
      return;
    }

    // Ask whether the user wants to manually annotate before processing.
    setFilesForAnnotator(batch);
    setCategoriesForBatch(cats);
    setAnnotationsForBatch({});
    setAnnotatePromptOpen(true);
  };

  const runProcessing = async (
    batch: File[],
    cats: string[],
    annotationsMap: Record<number, Annotation[]>,
    replaceStamp?: number,
  ) => {
    // If we're re-processing an existing batch (edit annotations), clear its prior
    // rows, previews (revoking blob URLs), and uploaded storage paths first.
    if (replaceStamp != null) {
      const stampPrefix = `${replaceStamp}-`;
      setRows((rs) => rs.filter((r) => !r.id.startsWith(stampPrefix)));
      const oldUrls = lastBatch?.previewUrls ?? [];
      setPreviews((ps) =>
        ps.filter((p) => {
          const drop = oldUrls.includes(p.url);
          if (drop && p.url.startsWith("blob:")) URL.revokeObjectURL(p.url);
          return !drop;
        }),
      );
      setUploadedPaths((paths) => paths.filter((p) => !p.startsWith(`${replaceStamp}/`)));
    }

    const batchStamp = replaceStamp ?? Date.now();
    const newPreviews = batch.map((f) => ({ url: URL.createObjectURL(f), name: f.name }));
    setPreviews((p) => [...p, ...newPreviews]);

    setLoading(true);
    setProgress({ done: 0, total: batch.length });
    let succeeded = 0;
    let failed = 0;
    let extracted = 0;

    const results = await Promise.allSettled(
      batch.map(async (file, idx) => {
        const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
        const path = `${batchStamp}/${idx}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const uploadP = supabase.storage
          .from("quotation-images")
          .upload(path, file, { contentType: file.type, upsert: false })
          .then((r) => (r.error ? null : path))
          .catch(() => null);
        const anns = (annotationsMap[idx] ?? []).map(({ id: _id, ...rest }) => rest);
        const { base64, mimeType } = await maskExcludedRegions(file, annotationsMap[idx] ?? []);
        // Don't also send the Exclude boxes as annotation hints — the pixels are
        // already blacked out, so the AI doesn't need to know about them.
        const annsForAi = anns.filter((a) => a.label !== "Exclude");
        const [res, storagePath] = await Promise.all([
          process({
            data: {
              imageBase64: base64,
              mimeType,
              allowedCategories: cats,
              defaultBrandByCategory,

              annotations: annsForAi,
            },
          }),
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
    // Remember this batch so the annotations can be reviewed/edited later.
    setLastBatch({
      stamp: batchStamp,
      files: batch,
      cats,
      annotations: annotationsMap,
      previewUrls: newPreviews.map((p) => p.url),
    });
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
    setSelectedCategories([]);
    setLastBatch(null);
    setEditingBatchStamp(null);
  };


  const confirmCategoriesAndProcess = () => {
    if (selectedCategories.length === 0) {
      toast.error("Select at least one category.");
      return;
    }
    setCategoryDialogOpen(false);
    const files = pendingFiles;
    setPendingFiles(null);
    if (files && files.length > 0) {
      onFiles(files, selectedCategories);
    }
  };

  const toggleCategory = (c: string) =>
    setSelectedCategories((xs) => (xs.includes(c) ? xs.filter((x) => x !== c) : [...xs, c]));

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

  // Extract "way count" for switches: "1 way", "one-way", "2way", "two way", etc.
  // Returned as normalized digit strings ("1", "2", "3"). Used as a hard gate
  // so a "Two way Switch" never re-matches to a "1 WAY SWITCH".
  const WAY_WORDS: Record<string, string> = {
    one: "1", two: "2", three: "3", four: "4",
    single: "1", double: "2", triple: "3",
  };
  const extractWayCount = (text: string): Set<string> => {
    const out = new Set<string>();
    const s = text.toLowerCase();
    for (const m of s.matchAll(/(\d+)\s*-?\s*way\b/g)) out.add(m[1]);
    for (const m of s.matchAll(/\b(one|two|three|four|single|double|triple)\s*-?\s*way\b/g)) {
      out.add(WAY_WORDS[m[1]]);
    }
    return out;
  };

  // Score with SIZE + WAY-COUNT as hard gates; token overlap only ranks compatible candidates.
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
    // Way-count hard gate: if extracted specifies N-way, candidate must too.
    const waysA = extractWayCount(A);
    const waysB = extractWayCount(B);
    if (waysA.size > 0) {
      let anyMatch = false;
      for (const w of waysA) if (waysB.has(w)) { anyMatch = true; break; }
      if (!anyMatch) return -1; // hard reject: wrong way-count (1-way vs 2-way)
    }
    let s = 0;
    if (B.includes(A) || A.includes(B)) s += 50;
    const tokensA = new Set(A.split(/\W+/).filter(Boolean));
    const tokensB = new Set(B.split(/\W+/).filter(Boolean));
    for (const t of tokensA) if (tokensB.has(t)) s += 1;
    // Reward exact size overlap count
    for (const sz of sizesA) if (sizesB.has(sz)) s += 10;
    // Reward way-count agreement strongly
    for (const w of waysA) if (waysB.has(w)) s += 20;
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
        // Way-count pre-filter: if the extracted text specifies N-way, drop
        // candidates that specify a different N-way. Never coerce to a wrong
        // way-count variant (e.g. "Two way Switch" → "1 WAY SWITCH").
        const waysWanted = extractWayCount(r.extractedText);
        if (waysWanted.size > 0) {
          const wayFiltered = candidates.filter((c) => {
            const cw = extractWayCount(c.item_name);
            if (cw.size === 0) return true; // candidate is way-agnostic
            for (const w of waysWanted) if (cw.has(w)) return true;
            return false;
          });
          if (wayFiltered.length > 0) candidates = wayFiltered;
          else return { ...r, itemCode: null };
        }
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

  const workspaceFont = { fontFamily: "'Manrope', ui-sans-serif, system-ui, sans-serif" } as const;
  const headingFont = { fontFamily: "'Sora', ui-sans-serif, system-ui, sans-serif" } as const;
  const hasResults = rows.length > 0;

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-8" style={workspaceFont}>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground" style={headingFont}>
          Quotation Workspace
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Upload customer quote images. AI extracts items and matches them against your inventory.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEFT: Inputs & Config */}
        <Card className="lg:col-span-5 p-6 space-y-6 bg-card">
          {/* Customer */}
          <section>
            <label
              className="block text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2"
              style={headingFont}
            >
              Customer
            </label>
            <Input
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Whom is this quotation for?"
              className="h-10"
            />
          </section>

          {/* Categories */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <label
                className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground"
                style={headingFont}
              >
                Search Categories
              </label>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={(e) => {
                  e.stopPropagation();
                  setCategoryDialogOpen(true);
                }}
              >
                <Filter className="h-3 w-3 mr-1" />
                {selectedCategories.length === 0 ? "Select" : `Edit (${selectedCategories.length})`}
              </Button>
            </div>
            {selectedCategories.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Required — pick which categories the AI may match items from.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {selectedCategories.map((c) => (
                  <span
                    key={c}
                    className="px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium"
                  >
                    {c}
                  </span>
                ))}
              </div>
            )}
          </section>

          {/* Upload */}
          <section>
            <label
              className="block text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-3"
              style={headingFont}
            >
              Quotation Images
            </label>
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const files = Array.from(e.dataTransfer.files ?? []);
                if (files.length) onFiles(files);
              }}
              onClick={() => fileRef.current?.click()}
              className="group border-2 border-dashed border-border rounded-xl p-6 text-center cursor-pointer hover:border-primary hover:bg-accent/30 transition-colors bg-muted/30"
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
                <div className="flex flex-col items-center gap-3 py-4 text-primary">
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
                        className="relative"
                        title={`Click to zoom · ${p.name}`}
                      >
                        <img
                          src={p.url}
                          alt={p.name}
                          className="h-20 w-20 object-cover rounded-lg border hover:ring-2 hover:ring-primary transition"
                        />
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        fileRef.current?.click();
                      }}
                      className="h-20 w-20 rounded-lg border-2 border-dashed border-border hover:border-primary hover:bg-accent/40 flex flex-col items-center justify-center text-primary transition"
                      title="Add more images"
                    >
                      <Upload className="h-5 w-5" />
                      <span className="text-[10px] mt-1 font-medium">Add more</span>
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {previews.length} uploaded · click Add more or drop files to append (up to {MAX_IMAGES} per batch)
                  </p>
                  {lastBatch && lastBatch.files.length > 0 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setFilesForAnnotator(lastBatch.files);
                        setCategoriesForBatch(lastBatch.cats);
                        setAnnotationsForBatch(lastBatch.annotations);
                        setEditingBatchStamp(lastBatch.stamp);
                        setAnnotatorOpen(true);
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5 mr-1.5" />
                      View / edit annotations
                    </Button>
                  )}
                </div>


              ) : (
                <div className="flex flex-col items-center gap-3 py-2">
                  <div className="w-12 h-12 rounded-full bg-card shadow-sm flex items-center justify-center group-hover:scale-110 transition-transform">
                    <Upload className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      Drop files here or <span className="text-primary">browse</span>
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      JPEG or PNG · up to {MAX_IMAGES} at a time
                    </p>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Brand per Category */}
          {detectedCategories.length > 0 && (
            <section className="pt-2 border-t">
              <label
                className="block text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-3"
                style={headingFont}
              >
                Brand per Category
              </label>
              <div className="space-y-2">
                {detectedCategories.map((catName) => (
                  <CategoryBrandRow
                    key={catName}
                    categoryName={catName}
                    known={categoryExists.has(catName)}
                    selectedBrand={brandByCategory[catName] ?? defaultBrandByCategory[catName] ?? ""}
                    brands={brandsByCategory[catName] ?? []}
                    onSelectBrand={(brand) => applyBrandToCategory(catName, brand)}
                  />
                ))}
              </div>
            </section>
          )}
        </Card>

        {/* RIGHT: Results */}
        <Card className="lg:col-span-7 p-6 bg-muted/20 min-h-[520px] flex flex-col">
          <header className="flex items-center justify-between mb-5">
            <h2 className="text-base font-semibold text-foreground" style={headingFont}>
              Results
            </h2>
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "w-2 h-2 rounded-full",
                  loading ? "bg-primary animate-pulse" : hasResults ? "bg-success" : "bg-muted-foreground/50",
                )}
              />
              <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                {loading ? "Processing" : hasResults ? `${rows.length} Items` : "Awaiting Data"}
              </span>
            </div>
          </header>

          {!hasResults ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
              <div className="w-20 h-20 bg-muted rounded-2xl flex items-center justify-center mb-5">
                <Upload className="h-8 w-8 text-muted-foreground" strokeWidth={1.5} />
              </div>
              <h3 className="text-base font-semibold mb-1.5" style={headingFont}>
                No items yet
              </h3>
              <p className="text-sm text-muted-foreground max-w-xs">
                Select search categories and upload quotation images to populate this workspace.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-4 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  Click a matched name to override
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="ghost" size="sm" onClick={clearAll}>
                    <X className="h-4 w-4 mr-1.5" /> Clear
                  </Button>
                  <Button variant="outline" size="sm" onClick={saveToHistory} disabled={saving}>
                    <Save className="h-4 w-4 mr-1.5" /> {saving ? "Saving…" : "Save"}
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleCopy}>
                    <Copy className="h-4 w-4 mr-1.5" /> Copy
                  </Button>
                  <Button size="sm" onClick={handleExportXlsx}>
                    <FileDown className="h-4 w-4 mr-1.5" /> Export
                  </Button>
                </div>
              </div>

              <div className="border rounded-xl overflow-visible bg-card">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="text-left p-3 font-medium">Extracted Text</th>
                      <th className="text-left p-3 font-medium">Database Match</th>
                      <th className="text-left p-3 font-medium">Category</th>
                      <th className="text-left p-3 font-medium w-20">Qty</th>
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
            </div>
          )}
        </Card>
      </div>


      <Dialog open={!!zoomed} onOpenChange={(o) => !o && setZoomed(null)}>
        <DialogContent className="max-w-[95vw] w-fit p-2 sm:p-3">
          <DialogTitle className="sr-only">{zoomed?.name ?? "Image preview"}</DialogTitle>
          <button
            type="button"
            onClick={() => setZoomed(null)}
            aria-label="Close image preview"
            title="Close"
            className="absolute top-2 left-2 z-20 inline-flex h-9 w-9 items-center justify-center rounded-lg border bg-background/90 backdrop-blur shadow hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
          {zoomed && <ZoomPanViewer src={zoomed.url} alt={zoomed.name} />}
        </DialogContent>
      </Dialog>



      <Dialog
        open={categoryDialogOpen}
        onOpenChange={(o) => {
          setCategoryDialogOpen(o);
          if (!o) setPendingFiles(null);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Search Categories</DialogTitle>
            <DialogDescription>
              Tick the categories the AI is allowed to search in. Items outside these
              categories will not be matched. This selection is required before processing images.
            </DialogDescription>
          </DialogHeader>

          {categories.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No categories found in Master Inventory yet.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2 pt-1 pb-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setSelectedCategories(categories)}
              >
                Select all
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setSelectedCategories([])}
              >
                Clear
              </Button>
            </div>
          )}

          <div className="max-h-[50vh] overflow-y-auto border rounded-md divide-y">
            {categories.map((c) => {
              const checked = selectedCategories.includes(c);
              return (
                <label
                  key={c}
                  className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-accent/50"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => toggleCategory(c)}
                  />
                  <span className="text-sm">{c}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {brandsByCategory[c]?.length ?? 0} brand{(brandsByCategory[c]?.length ?? 0) === 1 ? "" : "s"}
                  </span>
                </label>
              );
            })}
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setCategoryDialogOpen(false);
                setPendingFiles(null);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={confirmCategoriesAndProcess}
              disabled={selectedCategories.length === 0 || categories.length === 0}
            >
              {pendingFiles && pendingFiles.length > 0
                ? `Process ${pendingFiles.length} image${pendingFiles.length === 1 ? "" : "s"}`
                : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Annotation prompt */}
      <Dialog open={annotatePromptOpen} onOpenChange={setAnnotatePromptOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Annotate before processing?</DialogTitle>
            <DialogDescription>
              You can draw boxes on the image to mark categories, brands, items, and where
              a group ends. This helps the AI match items more accurately. Optional — skip
              to process straight away.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setAnnotatePromptOpen(false);
                runProcessing(filesForAnnotator, categoriesForBatch, {});
              }}
            >
              Skip
            </Button>
            <Button
              onClick={() => {
                setAnnotatePromptOpen(false);
                setAnnotatorOpen(true);
              }}
            >
              Annotate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Annotation editor */}
      <AnnotationEditor
        open={annotatorOpen}
        onOpenChange={setAnnotatorOpen}
        files={filesForAnnotator}
        initial={annotationsForBatch}
        onSubmit={(map) => {
          setAnnotationsForBatch(map);
          setAnnotatorOpen(false);
          const stamp = editingBatchStamp;
          setEditingBatchStamp(null);
          runProcessing(filesForAnnotator, categoriesForBatch, map, stamp ?? undefined);
        }}

      />
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
