import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
  Plus,
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

type Category = { id: string; name: string };
type Brand = { id: string; category_id: string; name: string };

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Quotation Workspace — QuickQuote" },
      { name: "description", content: "Upload customer quote images, classify by category, lock per-category brand, and export." },
    ],
  }),
  component: Workspace,
});

function Workspace() {
  const process = useServerFn(processQuotation);
  const fileRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [previews, setPreviews] = useState<{ url: string; name: string }[]>([]);
  const [zoomed, setZoomed] = useState<{ url: string; name: string } | null>(null);
  // category name → selected brand name
  const [brandByCategory, setBrandByCategory] = useState<Record<string, string>>({});

  const inventoryQ = useQuery({
    queryKey: ["inventory"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory")
        .select("item_code,item_name,category,brand")
        .order("item_name");
      if (error) throw error;
      return (data ?? []) as InventoryRow[];
    },
  });
  const categoriesQ = useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const { data, error } = await supabase.from("categories").select("id,name").order("name");
      if (error) throw error;
      return (data ?? []) as Category[];
    },
  });
  const brandsQ = useQuery({
    queryKey: ["brands"],
    queryFn: async () => {
      const { data, error } = await supabase.from("brands").select("id,category_id,name").order("name");
      if (error) throw error;
      return (data ?? []) as Brand[];
    },
  });

  const inventory = inventoryQ.data ?? [];
  const categories = categoriesQ.data ?? [];
  const brands = brandsQ.data ?? [];
  const invByCode = useMemo(() => new Map(inventory.map((i) => [i.item_code, i])), [inventory]);
  const catByName = useMemo(() => new Map(categories.map((c) => [c.name, c])), [categories]);

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
    let extracted = 0;

    const results = await Promise.allSettled(
      batch.map(async (file, idx) => {
        const base64 = await fileToBase64(file);
        const res = await process({ data: { imageBase64: base64, mimeType: file.type } });
        return { idx, items: res.items };
      }),
    );

    for (const r of results) {
      if (r.status === "fulfilled") {
        succeeded += 1;
        const { idx, items } = r.value;
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
        console.error(r.reason);
        toast.error("One image failed: " + (r.reason as Error).message);
        setProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
      }
    }

    setLoading(false);
    setProgress(null);
    toast.success(`Extracted ${extracted} item${extracted === 1 ? "" : "s"} from ${succeeded} of ${batch.length} image${batch.length === 1 ? "" : "s"}.`);
  };

  const clearAll = () => {
    previews.forEach((p) => URL.revokeObjectURL(p.url));
    setPreviews([]);
    setRows([]);
    setBrandByCategory({});
  };

  // Categories detected across current rows
  const detectedCategories = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.category) set.add(r.category);
    return Array.from(set).sort();
  }, [rows]);

  // Fuzzy similarity for re-matching within (category, brand)
  const score = (a: string, b: string) => {
    const A = a.toLowerCase();
    const B = b.toLowerCase();
    if (B.includes(A) || A.includes(B)) return 100;
    const tokensA = new Set(A.split(/\W+/).filter(Boolean));
    const tokensB = new Set(B.split(/\W+/).filter(Boolean));
    let hit = 0;
    for (const t of tokensA) if (tokensB.has(t)) hit++;
    return hit;
  };

  const applyBrandToCategory = (categoryName: string, brandName: string) => {
    setBrandByCategory((m) => ({ ...m, [categoryName]: brandName }));
    setRows((rs) =>
      rs.map((r) => {
        if (r.category !== categoryName) return r;
        const candidates = inventory.filter(
          (i) => (i.category ?? "") === categoryName && i.brand === brandName,
        );
        if (candidates.length === 0) return r;
        let best = candidates[0];
        let bestScore = -1;
        for (const c of candidates) {
          const s = score(r.extractedText, c.item_name);
          if (s > bestScore) {
            bestScore = s;
            best = c;
          }
        }
        return { ...r, itemCode: best.item_code };
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
                categoryId={catByName.get(catName)?.id}
                selectedBrand={brandByCategory[catName] ?? ""}
                brands={brands.filter((b) => b.category_id === catByName.get(catName)?.id)}
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
  categoryId,
  selectedBrand,
  brands,
  onSelectBrand,
}: {
  categoryName: string;
  categoryId: string | undefined;
  selectedBrand: string;
  brands: Brand[];
  onSelectBrand: (brand: string) => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [newBrand, setNewBrand] = useState("");

  const addBrand = async () => {
    if (!categoryId || !newBrand.trim()) return;
    const { error } = await supabase.from("brands").insert({ category_id: categoryId, name: newBrand.trim() });
    if (error) {
      toast.error(error.message);
      return;
    }
    setNewBrand("");
    qc.invalidateQueries({ queryKey: ["brands"] });
    toast.success("Brand added");
  };

  const removeBrand = async (id: string, name: string) => {
    const { error } = await supabase.from("brands").delete().eq("id", id);
    if (error) return toast.error(error.message);
    if (selectedBrand === name) onSelectBrand("");
    qc.invalidateQueries({ queryKey: ["brands"] });
  };

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
                {categoryId ? "No brands yet. Add one below." : "Category not defined in Categories tab."}
              </CommandEmpty>
              <CommandGroup>
                {brands.map((b) => (
                  <CommandItem
                    key={b.id}
                    value={b.name}
                    onSelect={() => {
                      onSelectBrand(b.name);
                      setOpen(false);
                    }}
                    className="flex items-center justify-between"
                  >
                    <span className="flex items-center gap-2">
                      <Check className={cn("h-3 w-3", selectedBrand === b.name ? "opacity-100" : "opacity-0")} />
                      {b.name}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeBrand(b.id, b.name);
                      }}
                      className="text-muted-foreground hover:text-destructive"
                      title="Delete brand"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
            {categoryId && (
              <div className="border-t p-2 flex gap-1">
                <Input
                  placeholder="Add brand…"
                  value={newBrand}
                  onChange={(e) => setNewBrand(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addBrand();
                    }
                  }}
                  className="h-8"
                />
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={addBrand}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            )}
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
