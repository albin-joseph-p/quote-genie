import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Upload,
  Loader2,
  FileDown,
  Save,
  Trash2,
  Filter,
  X,
  Calendar as CalendarIcon,
} from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { format, parse, isValid } from "date-fns";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Calendar } from "@/components/ui/calendar";
import { supabase } from "@/integrations/supabase/client";
import { processPurchase, type PurchaseFieldKey, type PurchaseLine } from "@/lib/purchase.functions";
import { fetchAllRows } from "@/lib/fetch-all";
import { cn } from "@/lib/utils";

type InventoryRow = { item_code: string; item_name: string; category: string | null; brand: string };

type FieldDef = { key: PurchaseFieldKey; label: string; numeric: boolean };
const FIELDS: FieldDef[] = [
  { key: "itemName", label: "Item name", numeric: false },
  { key: "hsn", label: "HSN", numeric: false },
  { key: "qty", label: "Qty", numeric: true },
  { key: "unitPrice", label: "Unit price", numeric: true },
  { key: "discount", label: "Discount", numeric: true },
  { key: "taxableValue", label: "Taxable value", numeric: true },
  { key: "cgst", label: "CGST", numeric: true },
  { key: "sgst", label: "SGST", numeric: true },
  { key: "igst", label: "IGST", numeric: true },
  { key: "total", label: "Total", numeric: true },
];
const DEFAULT_FIELDS: PurchaseFieldKey[] = [
  "itemName",
  "hsn",
  "qty",
  "unitPrice",
  "taxableValue",
  "cgst",
  "sgst",
  "igst",
  "total",
];

type Row = PurchaseLine & { id: string };

export const Route = createFileRoute("/_authenticated/purchases")({
  head: () => ({
    meta: [
      { title: "Purchase Entry — Orion Sales Corporation" },
      { name: "description", content: "Upload supplier bills, extract items, taxes, and match to inventory." },
    ],
  }),
  component: PurchaseWorkspace,
});

const fileToBase64 = (f: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = r.result as string;
      const idx = s.indexOf(",");
      resolve(idx >= 0 ? s.slice(idx + 1) : s);
    };
    r.onerror = () => reject(new Error("read failed"));
    r.readAsDataURL(f);
  });

function PurchaseWorkspace() {
  const process = useServerFn(processPurchase);
  const fileRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [previews, setPreviews] = useState<{ url: string; name: string }[]>([]);
  const [uploadedPaths, setUploadedPaths] = useState<string[]>([]);
  const [supplierName, setSupplierName] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState<string>(() => format(new Date(), "dd-MM-yyyy"));
  const [fields, setFields] = useState<PurchaseFieldKey[]>(DEFAULT_FIELDS);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);

  const { data: inventory = [] } = useQuery({
    queryKey: ["inventory-purchase"],
    queryFn: () => fetchAllRows<InventoryRow>("inventory", "item_code,item_name,category,brand"),
    staleTime: 60_000,
  });

  const categoryNames = useMemo(() => {
    const s = new Set<string>();
    for (const i of inventory) {
      const c = (i.category ?? "").trim();
      if (c) s.add(c);
    }
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [inventory]);

  const { data: history = [], refetch: refetchHistory } = useQuery({
    queryKey: ["purchases-history"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchases")
        .select("id,supplier_name,invoice_number,invoice_date,item_count,created_at")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

  const toggleField = (k: PurchaseFieldKey) =>
    setFields((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));

  const onPick = () => fileRef.current?.click();

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    if (fields.length === 0) {
      toast.error("Select at least one field to capture.");
      return;
    }
    const arr = Array.from(files);
    setLoading(true);
    try {
      for (let idx = 0; idx < arr.length; idx++) {
        const file = arr[idx];
        const previewUrl = URL.createObjectURL(file);
        setPreviews((p) => [...p, { url: previewUrl, name: file.name }]);

        // Upload
        const stamp = Date.now();
        const path = `purchases/${stamp}-${idx}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        const up = await supabase.storage.from("quotation-images").upload(path, file, {
          contentType: file.type || "image/jpeg",
          upsert: false,
        });
        if (!up.error) setUploadedPaths((p) => [...p, up.data.path]);

        const b64 = await fileToBase64(file);
        const res = await process({
          data: {
            imageBase64: b64,
            mimeType: file.type || "image/jpeg",
            fields,
            allowedCategories: selectedCategories.length ? selectedCategories : undefined,
          },
        });
        if (res.error) {
          toast.error(res.error.message);
          continue;
        }
        if (res.supplierName) setSupplierName(res.supplierName);
        if (res.invoiceNumber) setInvoiceNumber(res.invoiceNumber);
        if (res.invoiceDate) {
          // Try to normalize to dd-MM-yyyy; keep raw string if unparseable
          const raw = res.invoiceDate.trim();
          const patterns = ["dd-MM-yyyy", "dd/MM/yyyy", "d-M-yyyy", "d/M/yyyy", "yyyy-MM-dd", "dd-MM-yy", "dd/MM/yy", "dd.MM.yyyy", "d MMM yyyy", "dd MMM yyyy", "MMMM d, yyyy"];
          let normalized = raw;
          for (const p of patterns) {
            const d = parse(raw, p, new Date());
            if (isValid(d)) { normalized = format(d, "dd-MM-yyyy"); break; }
          }
          setInvoiceDate(normalized);
        }

        const newRows: Row[] = res.items.map((it, i) => ({
          ...it,
          id: `${stamp}-${i}-${Math.random().toString(36).slice(2, 7)}`,
        }));
        setRows((prev) => [...prev, ...newRows]);
        toast.success(`Extracted ${newRows.length} line(s) from ${file.name}`);
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to process bill");
    } finally {
      setLoading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const updateRow = (id: string, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const deleteRow = (id: string) => setRows((prev) => prev.filter((r) => r.id !== id));

  const clearAll = () => {
    setRows([]);
    setPreviews([]);
    setUploadedPaths([]);
    setSupplierName("");
    setInvoiceNumber("");
    setInvoiceDate(format(new Date(), "dd-MM-yyyy"));
  };

  const buildExportTable = () => {
    const header = [
      "Item name",
      "Matched code",
      "Category",
      ...FIELDS.filter((f) => f.key !== "itemName" && fields.includes(f.key)).map((f) => f.label),
    ];
    const body = rows.map((r) => [
      r.itemName,
      r.itemCode ?? "",
      r.category ?? "",
      ...FIELDS.filter((f) => f.key !== "itemName" && fields.includes(f.key)).map((f) => {
        const v = r[f.key as keyof PurchaseLine];
        return v ?? "";
      }),
    ]);
    return { header, body };
  };

  const exportXlsx = () => {
    if (!rows.length) return toast.error("Nothing to export.");
    const { header, body } = buildExportTable();
    const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Purchase");
    XLSX.writeFile(wb, `purchase-${supplierName || "bill"}-${Date.now()}.xlsx`);
  };

  const exportCsv = () => {
    if (!rows.length) return toast.error("Nothing to export.");
    const { header, body } = buildExportTable();
    const escape = (v: unknown) => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [header, ...body].map((row) => row.map(escape).join(",")).join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `purchase-${supplierName || "bill"}-${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const savePurchase = async () => {
    if (!rows.length) return toast.error("Nothing to save.");
    setSaving(true);
    try {
      const { error } = await supabase.from("purchases").insert({
        supplier_name: supplierName,
        invoice_number: invoiceNumber,
        invoice_date: invoiceDate,
        item_count: rows.length,
        items: rows,
        captured_fields: fields,
        image_urls: uploadedPaths,
      });
      if (error) throw error;
      toast.success("Purchase saved to history.");
      refetchHistory();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-6 py-8 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Purchase Entry</h1>
          <p className="text-sm text-muted-foreground">
            Upload supplier bill images. AI extracts items, taxes, and matches your inventory.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <CategoryFilterButton
            categories={categoryNames}
            selected={selectedCategories}
            setSelected={setSelectedCategories}
            open={categoryDialogOpen}
            setOpen={setCategoryDialogOpen}
          />
          <FieldPicker fields={fields} toggleField={toggleField} />
        </div>
      </div>

      <Card className="p-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Supplier</label>
            <SupplierAutocomplete value={supplierName} onChange={setSupplierName} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Invoice #</label>
            <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="INV-1234" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Invoice date</label>
            <InvoiceDatePicker value={invoiceDate} onChange={setInvoiceDate} />
          </div>
        </div>

        <div
          className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:bg-accent/40 transition"
          onClick={onPick}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            onFiles(e.dataTransfer.files);
          }}
        >
          <Upload className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
          <p className="font-medium">Drop bill images or PDFs, or click to upload</p>
          <p className="text-xs text-muted-foreground mt-1">JPEG / PNG / PDF — multiple pages supported</p>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,application/pdf"
            multiple
            className="hidden"
            onChange={(e) => onFiles(e.target.files)}
          />
        </div>

        {previews.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            {previews.map((p) => (
              <img
                key={p.url}
                src={p.url}
                alt={p.name}
                className="h-20 w-20 object-cover rounded border"
              />
            ))}
          </div>
        )}

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Processing bill(s)…
          </div>
        )}
      </Card>

      {rows.length > 0 && (
        <Card className="p-0 overflow-hidden">
          <div className="p-4 flex items-center justify-between border-b">
            <div className="text-sm font-medium">
              {rows.length} line item{rows.length === 1 ? "" : "s"}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={clearAll}>
                <X className="h-4 w-4 mr-1" /> Clear
              </Button>
              <Button variant="outline" size="sm" onClick={exportXlsx}>
                <FileDown className="h-4 w-4 mr-1" /> Export Excel
              </Button>
              <Button variant="outline" size="sm" onClick={exportCsv}>
                <FileDown className="h-4 w-4 mr-1" /> Export CSV
              </Button>
              <Button size="sm" onClick={savePurchase} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
                Save
              </Button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="text-left">
                  {FIELDS.filter((f) => fields.includes(f.key)).map((f) => (
                    <th key={f.key} className="px-3 py-2 whitespace-nowrap">{f.label}</th>
                  ))}
                  <th className="px-3 py-2 whitespace-nowrap">Matched item</th>
                  <th className="px-3 py-2 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t align-top">
                    {FIELDS.filter((f) => fields.includes(f.key)).map((f) => (
                      <td key={f.key} className="px-3 py-2">
                        <Input
                          value={r[f.key as keyof PurchaseLine] === null || r[f.key as keyof PurchaseLine] === undefined ? "" : String(r[f.key as keyof PurchaseLine])}
                          onChange={(e) => {
                            const raw = e.target.value;
                            const v = f.numeric ? (raw === "" ? null : Number(raw)) : raw;
                            updateRow(r.id, { [f.key]: v } as Partial<Row>);
                          }}
                          className={cn("h-8", f.numeric && "text-right")}
                        />
                      </td>
                    ))}
                    <td className="px-3 py-2 min-w-[220px]">
                      <InventoryCombobox
                        inventory={inventory}
                        value={r.itemCode}
                        onChange={(code) => {
                          const inv = inventory.find((i) => i.item_code === code);
                          updateRow(r.id, { itemCode: code, category: inv?.category ?? r.category });
                        }}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <Button variant="ghost" size="icon" onClick={() => deleteRow(r.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {history.length > 0 && (
        <Card className="p-4">
          <div className="text-sm font-medium mb-3">Recent purchase entries</div>
          <div className="divide-y">
            {history.map((h) => (
              <div key={h.id} className="py-2 flex justify-between text-sm">
                <div>
                  <div className="font-medium">{h.supplier_name || "Untitled supplier"}</div>
                  <div className="text-xs text-muted-foreground">
                    {h.invoice_number ? `#${h.invoice_number} · ` : ""}
                    {h.invoice_date || new Date(h.created_at).toLocaleDateString()}
                  </div>
                </div>
                <Badge variant="secondary">{h.item_count} items</Badge>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function FieldPicker({
  fields,
  toggleField,
}: {
  fields: PurchaseFieldKey[];
  toggleField: (k: PurchaseFieldKey) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Filter className="h-4 w-4 mr-1" /> Fields ({fields.length})
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56">
        <div className="text-xs text-muted-foreground mb-2">Fields the AI should capture</div>
        <div className="space-y-1">
          {FIELDS.map((f) => (
            <label key={f.key} className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox
                checked={fields.includes(f.key)}
                onCheckedChange={() => toggleField(f.key)}
              />
              {f.label}
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function CategoryFilterButton({
  categories,
  selected,
  setSelected,
  open,
  setOpen,
}: {
  categories: string[];
  selected: string[];
  setSelected: (v: string[]) => void;
  open: boolean;
  setOpen: (v: boolean) => void;
}) {
  const [draft, setDraft] = useState<string[]>(selected);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setDraft(selected);
          setOpen(true);
        }}
      >
        <Filter className="h-4 w-4 mr-1" />
        Categories {selected.length ? `(${selected.length})` : ""}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Restrict inventory match</DialogTitle>
            <DialogDescription>
              Optional. Limit AI matching to these categories only.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-72 overflow-y-auto space-y-1">
            {categories.map((c) => (
              <label key={c} className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={draft.includes(c)}
                  onCheckedChange={() =>
                    setDraft((d) => (d.includes(c) ? d.filter((x) => x !== c) : [...d, c]))
                  }
                />
                {c}
              </label>
            ))}
            {categories.length === 0 && (
              <div className="text-sm text-muted-foreground">No categories yet.</div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDraft([])}>Clear</Button>
            <Button
              onClick={() => {
                setSelected(draft);
                setOpen(false);
              }}
            >
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
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
  const current = value ? inventory.find((i) => i.item_code === value) : null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 w-full justify-between font-normal">
          <span className="truncate text-left">
            {current ? `${current.item_code} — ${current.item_name}` : "Match item…"}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search inventory…" />
          <CommandList>
            <CommandEmpty>No match.</CommandEmpty>
            <CommandGroup>
              {value && (
                <CommandItem
                  onSelect={() => {
                    onChange(null);
                    setOpen(false);
                  }}
                >
                  <X className="h-4 w-4 mr-2" /> Clear match
                </CommandItem>
              )}
              {inventory.slice(0, 300).map((i) => (
                <CommandItem
                  key={i.item_code}
                  value={`${i.item_code} ${i.item_name} ${i.brand} ${i.category ?? ""}`}
                  onSelect={() => {
                    onChange(i.item_code);
                    setOpen(false);
                  }}
                >
                  <div className="flex flex-col">
                    <span className="text-sm">{i.item_name}</span>
                    <span className="text-xs text-muted-foreground">
                      {i.item_code} · {i.brand} · {i.category ?? "—"}
                    </span>
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

function SupplierAutocomplete({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers-autocomplete"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("suppliers")
        .select("id,name")
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
    staleTime: 60_000,
  });

  const q = value.trim().toLowerCase();
  const matches = q
    ? suppliers.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 8)
    : suppliers.slice(0, 8);

  return (
    <Popover open={open && matches.length > 0} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Input
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Supplier name"
          autoComplete="off"
        />
      </PopoverTrigger>
      <PopoverContent
        className="p-0 w-[--radix-popover-trigger-width]"
        align="start"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <Command shouldFilter={false}>
          <CommandList>
            <CommandEmpty>No matching supplier</CommandEmpty>
            <CommandGroup>
              {matches.map((s) => (
                <CommandItem
                  key={s.id}
                  value={s.name}
                  onSelect={() => {
                    onChange(s.name);
                    setOpen(false);
                  }}
                >
                  {s.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function InvoiceDatePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const parsed = value ? parse(value, "dd-MM-yyyy", new Date()) : undefined;
  const date = parsed && isValid(parsed) ? parsed : undefined;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "w-full justify-start text-left font-normal",
            !date && "text-muted-foreground",
          )}
        >
          <CalendarIcon className="h-4 w-4 mr-2" />
          {date ? format(date, "dd-MM-yyyy") : "Pick a date"}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={date}
          onSelect={(d) => {
            if (d) {
              onChange(format(d, "dd-MM-yyyy"));
              setOpen(false);
            }
          }}
          initialFocus
          className={cn("p-3 pointer-events-auto")}
        />
      </PopoverContent>
    </Popover>
  );
}
