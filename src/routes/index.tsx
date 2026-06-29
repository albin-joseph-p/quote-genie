import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Upload, Loader2, FileDown, Copy, CheckCircle2, Pencil, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { processQuotation } from "@/lib/quote.functions";
import { cn } from "@/lib/utils";

type PriceMode = "retail_price" | "contractor_price" | "wholesale_price";

type InventoryRow = {
  item_code: string;
  item_name: string;
  category: string | null;
  retail_price: number;
  contractor_price: number;
  wholesale_price: number;
};

type Row = {
  id: string;
  extractedText: string;
  itemCode: string | null;
  qty: number;
  manualPrice: number | null;
};

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Quotation Workspace — QuickQuote" },
      { name: "description", content: "Upload a customer quote image, auto-match items, set pricing, and export." },
    ],
  }),
  component: Workspace,
});

function Workspace() {
  const process = useServerFn(processQuotation);
  const fileRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [mode, setMode] = useState<PriceMode>("retail_price");
  const [rows, setRows] = useState<Row[]>([]);
  const [previews, setPreviews] = useState<{ url: string; name: string }[]>([]);

  const inventoryQ = useQuery({
    queryKey: ["inventory"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory")
        .select("*")
        .order("item_name");
      if (error) throw error;
      return (data ?? []) as InventoryRow[];
    },
  });
  const inventory = inventoryQ.data ?? [];
  const invByCode = useMemo(
    () => new Map(inventory.map((i) => [i.item_code, i])),
    [inventory],
  );

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
        return { idx, file, items: res.items };
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
          qty: it.customerQty ?? 1,
          manualPrice: null,
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
  };

  const defaultPriceFor = (code: string | null) =>
    code && invByCode.get(code) ? Number(invByCode.get(code)![mode]) : 0;

  const handleExportPdf = async () => {
    const { default: jsPDF } = await import("jspdf");
    const autoTable = (await import("jspdf-autotable")).default;
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text("Quotation", 14, 16);
    doc.setFontSize(10);
    doc.text(`Pricing: ${modeLabel(mode)}`, 14, 23);
    doc.text(new Date().toLocaleString(), 14, 28);

    let grand = 0;
    const body = rows.map((r) => {
      const inv = r.itemCode ? invByCode.get(r.itemCode) : undefined;
      const unit = r.manualPrice ?? defaultPriceFor(r.itemCode);
      const total = unit * r.qty;
      grand += total;
      return [
        inv?.item_name ?? r.extractedText,
        inv?.category ?? "",
        String(r.qty),
        unit.toFixed(2),
        total.toFixed(2),
      ];
    });
    autoTable(doc, {
      startY: 34,
      head: [["Item", "Category", "Qty", "Unit Price", "Total"]],
      body,
      foot: [["", "", "", "Grand Total", grand.toFixed(2)]],
      headStyles: { fillColor: [37, 99, 235] },
      footStyles: { fillColor: [240, 240, 245], textColor: 20, fontStyle: "bold" },
    });
    doc.save(`quotation-${Date.now()}.pdf`);
  };

  const handleCopy = async () => {
    const lines = [
      `QUOTATION (${modeLabel(mode)})`,
      "",
      ...rows.map((r) => {
        const inv = r.itemCode ? invByCode.get(r.itemCode) : undefined;
        const unit = r.manualPrice ?? defaultPriceFor(r.itemCode);
        const name = inv?.item_name ?? r.extractedText;
        return `${name}\tQty ${r.qty}\t₹${unit.toFixed(2)}\t= ₹${(unit * r.qty).toFixed(2)}`;
      }),
      "",
      `Grand Total: ₹${grandTotal(rows, mode, invByCode).toFixed(2)}`,
    ];
    await navigator.clipboard.writeText(lines.join("\n"));
    toast.success("Copied to clipboard.");
  };

  return (
    <div className="mx-auto max-w-7xl px-6 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Quotation Workspace</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Upload a customer quote image. AI extracts and matches items against your master inventory.
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
                  <div key={i} className="relative">
                    <img
                      src={p.url}
                      alt={p.name}
                      title={p.name}
                      className="h-24 w-24 object-cover rounded border"
                    />
                  </div>
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

      {/* Results */}
      {rows.length > 0 && (
        <Card className="p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-muted-foreground mr-2">Pricing Mode:</span>
              {(
                [
                  ["retail_price", "Retail"],
                  ["contractor_price", "Contractor"],
                  ["wholesale_price", "Wholesale"],
                ] as const
              ).map(([val, label]) => (
                <Button
                  key={val}
                  variant={mode === val ? "default" : "outline"}
                  size="sm"
                  onClick={() => {
                    setMode(val);
                    // reset manual edits so prices snap to new tier
                    setRows((rs) => rs.map((r) => ({ ...r, manualPrice: null })));
                  }}
                >
                  {label}
                </Button>
              ))}
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={clearAll}>
                <X className="h-4 w-4 mr-2" /> Clear all
              </Button>
              <Button variant="outline" size="sm" onClick={handleCopy}>
                <Copy className="h-4 w-4 mr-2" /> Copy
              </Button>
              <Button size="sm" onClick={handleExportPdf}>
                <FileDown className="h-4 w-4 mr-2" /> Export PDF
              </Button>
            </div>
          </div>

          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="text-left p-3 font-medium">Extracted</th>
                  <th className="text-left p-3 font-medium">Matched Item</th>
                  <th className="text-left p-3 font-medium">Category</th>
                  <th className="text-left p-3 font-medium w-20">Qty</th>
                  <th className="text-left p-3 font-medium w-40">Unit Price</th>
                  <th className="text-left p-3 font-medium w-28">Total</th>
                  <th className="text-left p-3 font-medium w-32">Status</th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const inv = r.itemCode ? invByCode.get(r.itemCode) : undefined;
                  const defaultPrice = defaultPriceFor(r.itemCode);
                  const unitPrice = r.manualPrice ?? defaultPrice;
                  const edited = r.manualPrice !== null;
                  return (
                    <tr
                      key={r.id}
                      className={cn(
                        "border-t",
                        edited && "bg-[var(--color-edited)]",
                      )}
                    >
                      <td className="p-3 align-top text-muted-foreground">{r.extractedText}</td>
                      <td className="p-3 align-top">
                        <Select
                          value={r.itemCode ?? "__none"}
                          onValueChange={(v) =>
                            setRows((rs) =>
                              rs.map((x) =>
                                x.id === r.id
                                  ? { ...x, itemCode: v === "__none" ? null : v, manualPrice: null }
                                  : x,
                              ),
                            )
                          }
                        >
                          <SelectTrigger className="h-9">
                            <SelectValue placeholder="— select item —" />
                          </SelectTrigger>
                          <SelectContent className="max-h-72">
                            <SelectItem value="__none">— no match —</SelectItem>
                            {inventory.map((i) => (
                              <SelectItem key={i.item_code} value={i.item_code}>
                                {i.item_name}{" "}
                                <span className="text-muted-foreground">({i.item_code})</span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="p-3 align-top text-muted-foreground">{inv?.category ?? "—"}</td>
                      <td className="p-3 align-top">
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
                      <td className="p-3 align-top">
                        <Input
                          type="number"
                          step="0.01"
                          value={unitPrice}
                          onChange={(e) =>
                            setRows((rs) =>
                              rs.map((x) =>
                                x.id === r.id ? { ...x, manualPrice: Number(e.target.value) } : x,
                              ),
                            )
                          }
                          className="h-9"
                        />
                        {inv && (
                          <p className="text-[10px] text-muted-foreground mt-1">
                            Range: ₹{Number(inv.wholesale_price).toFixed(0)} – ₹{Number(inv.retail_price).toFixed(0)}
                          </p>
                        )}
                      </td>
                      <td className="p-3 align-top font-medium">₹{(unitPrice * r.qty).toFixed(2)}</td>
                      <td className="p-3 align-top">
                        {!r.itemCode ? (
                          <Badge variant="destructive">No match</Badge>
                        ) : edited ? (
                          <Badge className="bg-[var(--color-edited)] text-foreground border border-border">
                            <Pencil className="h-3 w-3 mr-1" /> Edited
                          </Badge>
                        ) : (
                          <Badge variant="secondary">
                            <CheckCircle2 className="h-3 w-3 mr-1" /> Default
                          </Badge>
                        )}
                      </td>
                      <td className="p-3 align-top">
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
              <tfoot>
                <tr className="border-t bg-muted/30">
                  <td colSpan={5} className="p-3 text-right font-medium">
                    Grand Total
                  </td>
                  <td className="p-3 font-bold text-lg">
                    ₹{grandTotal(rows, mode, invByCode).toFixed(2)}
                  </td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function modeLabel(m: PriceMode) {
  return m === "retail_price" ? "Retail" : m === "contractor_price" ? "Contractor" : "Wholesale";
}

function grandTotal(rows: Row[], mode: PriceMode, inv: Map<string, InventoryRow>) {
  return rows.reduce((acc, r) => {
    const def = r.itemCode && inv.get(r.itemCode) ? Number(inv.get(r.itemCode)![mode]) : 0;
    const unit = r.manualPrice ?? def;
    return acc + unit * r.qty;
  }, 0);
}
