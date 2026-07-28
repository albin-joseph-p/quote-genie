import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Save, Trash2, Upload, X, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetch-all";
import type { PurchaseFieldKey } from "@/lib/purchase.functions";

export const Route = createFileRoute("/_authenticated/presets")({
  head: () => ({
    meta: [
      { title: "Format Presets — Orion Sales Corporation" },
      {
        name: "description",
        content: "Train the AI on custom bill formats by uploading sample bills and images of the expected output.",
      },
    ],
  }),
  component: PresetsPage,
});

const FIELDS: { key: PurchaseFieldKey; label: string }[] = [
  { key: "itemName", label: "Item name" },
  { key: "hsn", label: "HSN" },
  { key: "qty", label: "Qty" },
  { key: "unitPrice", label: "Unit price" },
  { key: "discount", label: "Discount" },
  { key: "taxableValue", label: "Taxable value" },
  { key: "cgst", label: "CGST" },
  { key: "sgst", label: "SGST" },
  { key: "igst", label: "IGST" },
  { key: "total", label: "Total" },
];

type Preset = {
  id: string;
  name: string;
  category: string;
  notes: string;
  sample_paths: string[];
  sample_mimes: string[];
  output_paths: string[];
  output_mimes: string[];
  field_keys: string[];
  is_active: boolean;
  created_at: string;
};

type Draft = {
  id: string | null;
  name: string;
  category: string;
  notes: string;
  sample_paths: string[];
  sample_mimes: string[];
  output_paths: string[];
  output_mimes: string[];
  field_keys: PurchaseFieldKey[];
  is_active: boolean;
};

const emptyDraft = (): Draft => ({
  id: null,
  name: "",
  category: "",
  notes: "",
  sample_paths: [],
  sample_mimes: [],
  output_paths: [],
  output_mimes: [],
  field_keys: ["itemName", "hsn", "qty", "unitPrice", "taxableValue", "cgst", "sgst", "total"],
  is_active: true,
});

type InventoryRow = { item_code: string; category: string | null };

function PresetsPage() {
  const inputFileRef = useRef<HTMLInputElement>(null);
  const outputFileRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [uploading, setUploading] = useState<"input" | "output" | null>(null);
  const [saving, setSaving] = useState(false);
  const [signed, setSigned] = useState<Record<string, string>>({});

  const { data: presets = [], refetch, isLoading } = useQuery({
    queryKey: ["purchase-presets"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchase_presets")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Preset[];
    },
  });

  const { data: inventory = [] } = useQuery({
    queryKey: ["inventory-preset-categories"],
    queryFn: () => fetchAllRows<InventoryRow>("inventory", "item_code,category"),
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

  const signFor = async (paths: string[]) => {
    const missing = paths.filter((p) => !signed[p]);
    if (!missing.length) return;
    const { data } = await supabase.storage.from("quotation-images").createSignedUrls(missing, 3600);
    const next: Record<string, string> = {};
    (data ?? []).forEach((d, i) => {
      if (d.signedUrl) next[missing[i]] = d.signedUrl;
    });
    if (Object.keys(next).length) setSigned((s) => ({ ...s, ...next }));
  };

  const onUpload = async (files: FileList | null, kind: "input" | "output") => {
    if (!files?.length) return;
    setUploading(kind);
    try {
      const paths: string[] = [];
      const mimes: string[] = [];
      for (const file of Array.from(files)) {
        const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
        const mime = file.type || (isPdf ? "application/pdf" : "image/jpeg");
        const path = `presets/${kind}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        const up = await supabase.storage.from("quotation-images").upload(path, file, {
          contentType: mime,
          upsert: false,
        });
        if (up.error) {
          toast.error(`Upload failed: ${file.name}`);
          continue;
        }
        paths.push(up.data.path);
        mimes.push(mime);
      }
      if (paths.length) {
        setDraft((d) =>
          kind === "input"
            ? { ...d, sample_paths: [...d.sample_paths, ...paths], sample_mimes: [...d.sample_mimes, ...mimes] }
            : { ...d, output_paths: [...d.output_paths, ...paths], output_mimes: [...d.output_mimes, ...mimes] },
        );
        await signFor(paths);
        toast.success(`${paths.length} ${kind} sample(s) added`);
      }
    } finally {
      setUploading(null);
      const ref = kind === "input" ? inputFileRef : outputFileRef;
      if (ref.current) ref.current.value = "";
    }
  };

  const removeSample = (idx: number, kind: "input" | "output") =>
    setDraft((d) =>
      kind === "input"
        ? {
            ...d,
            sample_paths: d.sample_paths.filter((_, i) => i !== idx),
            sample_mimes: d.sample_mimes.filter((_, i) => i !== idx),
          }
        : {
            ...d,
            output_paths: d.output_paths.filter((_, i) => i !== idx),
            output_mimes: d.output_mimes.filter((_, i) => i !== idx),
          },
    );

  const toggleField = (k: PurchaseFieldKey) =>
    setDraft((d) => ({
      ...d,
      field_keys: d.field_keys.includes(k) ? d.field_keys.filter((x) => x !== k) : [...d.field_keys, k],
    }));

  const edit = async (p: Preset) => {
    setDraft({
      id: p.id,
      name: p.name,
      category: p.category ?? "",
      notes: p.notes,
      sample_paths: p.sample_paths ?? [],
      sample_mimes: p.sample_mimes ?? [],
      output_paths: p.output_paths ?? [],
      output_mimes: p.output_mimes ?? [],
      field_keys: (p.field_keys ?? []) as PurchaseFieldKey[],
      is_active: p.is_active,
    });
    await signFor([...(p.sample_paths ?? []), ...(p.output_paths ?? [])]);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const save = async () => {
    if (!draft.name.trim()) return toast.error("Give the preset a name.");
    if (!draft.category.trim()) return toast.error("Select a category for this preset.");
    if (!draft.sample_paths.length) return toast.error("Upload at least one sample bill (input).");
    if (!draft.output_paths.length) return toast.error("Upload at least one expected-output image.");
    if (!draft.field_keys.length) return toast.error("Select at least one output field.");
    setSaving(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const payload = {
        name: draft.name.trim(),
        category: draft.category.trim(),
        notes: draft.notes,
        sample_paths: draft.sample_paths,
        sample_mimes: draft.sample_mimes,
        output_paths: draft.output_paths,
        output_mimes: draft.output_mimes,
        field_keys: draft.field_keys,
        is_active: draft.is_active,
        created_by: userData.user?.id ?? null,
      };
      const res = draft.id
        ? await supabase.from("purchase_presets").update(payload).eq("id", draft.id)
        : await supabase.from("purchase_presets").insert(payload);
      if (res.error) throw res.error;
      toast.success(draft.id ? "Preset updated" : "Preset created");
      setDraft(emptyDraft());
      refetch();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to save preset");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("purchase_presets").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Preset deleted");
    if (draft.id === id) setDraft(emptyDraft());
    refetch();
  };

  const renderThumbs = (paths: string[], mimes: string[], kind: "input" | "output") => (
    <div className="flex flex-wrap gap-3">
      {paths.map((p, i) => (
        <div key={p} className="relative h-28 w-28 rounded-md border overflow-hidden bg-muted">
          {mimes[i] === "application/pdf" ? (
            <a
              href={signed[p]}
              target="_blank"
              rel="noreferrer"
              className="flex h-full w-full items-center justify-center text-xs font-medium"
            >
              PDF
            </a>
          ) : (
            <a href={signed[p]} target="_blank" rel="noreferrer">
              <img src={signed[p]} alt={`${kind} sample`} className="h-full w-full object-cover" />
            </a>
          )}
          <button
            onClick={() => removeSample(i, kind)}
            className="absolute right-1 top-1 rounded bg-background/90 p-0.5"
            aria-label="Remove sample"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
      <button
        onClick={() => (kind === "input" ? inputFileRef : outputFileRef).current?.click()}
        className="h-28 w-28 rounded-md border border-dashed flex flex-col items-center justify-center gap-1 text-xs text-muted-foreground hover:bg-accent"
      >
        {uploading === kind ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        Add {kind === "input" ? "bill" : "output"}
      </button>
    </div>
  );

  return (
    <div className="mx-auto max-w-7xl px-6 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Format Presets</h1>
        <p className="text-sm text-muted-foreground">
          Teach the AI a bill layout per category: upload sample bills and images of the expected result. The AI reads
          the text off the output images and learns to reproduce it.
        </p>
      </div>

      <Card className="p-5 space-y-6">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Preset name</label>
            <Input
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="e.g. Switches — GST bill layout"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Category</label>
            <select
              value={draft.category}
              onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              aria-label="Category"
            >
              <option value="">Select category…</option>
              {categoryNames.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
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

        {/* INPUT */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">Input — sample bills</h2>
          {renderThumbs(draft.sample_paths, draft.sample_mimes, "input")}
          <input
            ref={inputFileRef}
            type="file"
            multiple
            accept="image/*,application/pdf"
            className="hidden"
            onChange={(e) => onUpload(e.target.files, "input")}
          />
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Layout rules / notes for the AI</label>
            <Textarea
              rows={3}
              value={draft.notes}
              onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
              placeholder="e.g. Rate column is before discount. Ignore the 'MRP' column. Item description spans two lines."
            />
          </div>
        </section>

        {/* OUTPUT */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">Output — expected result (uploaded as image)</h2>
          <p className="text-xs text-muted-foreground">
            Upload a screenshot / photo of the correctly extracted table for the bill above. The AI reads the text from
            it and trains on that exact output.
          </p>
          {renderThumbs(draft.output_paths, draft.output_mimes, "output")}
          <input
            ref={outputFileRef}
            type="file"
            multiple
            accept="image/*,application/pdf"
            className="hidden"
            onChange={(e) => onUpload(e.target.files, "output")}
          />

          <div>
            <label className="text-xs font-medium text-muted-foreground">Fields to capture</label>
            <div className="flex flex-wrap gap-3 pt-2">
              {FIELDS.map((f) => (
                <label key={f.key} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={draft.field_keys.includes(f.key)} onCheckedChange={() => toggleField(f.key)} />
                  {f.label}
                </label>
              ))}
            </div>
          </div>
        </section>

        <div className="flex items-center gap-2">
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
            {draft.id ? "Update preset" : "Save preset"}
          </Button>
          {draft.id && (
            <Button variant="outline" onClick={() => setDraft(emptyDraft())}>
              Cancel edit
            </Button>
          )}
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <Sparkles className="h-4 w-4" /> Saved presets
        </h2>
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
                    {p.category || "no category"} · {(p.sample_paths ?? []).length} bill(s) ·{" "}
                    {(p.output_paths ?? []).length} output image(s) · {(p.field_keys ?? []).length} field(s)
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
