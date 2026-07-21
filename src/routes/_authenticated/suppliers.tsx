import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Search, Loader2, Save, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";

type Supplier = {
  id: string;
  name: string;
  contact: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  created_at: string;
};

export const Route = createFileRoute("/_authenticated/suppliers")({
  head: () => ({
    meta: [
      { title: "Suppliers — Orion Sales Corporation" },
      { name: "description", content: "Manage suppliers for purchase entry." },
    ],
  }),
  component: SuppliersPage,
});

function emptyForm(): Omit<Supplier, "id" | "created_at"> {
  return { name: "", contact: "", phone: "", email: "", address: "", notes: "" };
}

function SuppliersPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Supplier | null>(null);

  const { data: suppliers = [], isLoading } = useQuery({
    queryKey: ["suppliers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("suppliers")
        .select("id,name,contact,phone,email,address,notes,created_at")
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Supplier[];
    },
    staleTime: 30_000,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return suppliers;
    return suppliers.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.contact ?? "").toLowerCase().includes(q) ||
        (s.phone ?? "").toLowerCase().includes(q) ||
        (s.email ?? "").toLowerCase().includes(q),
    );
  }, [suppliers, search]);

  const openNew = () => {
    setEditing(null);
    setForm(emptyForm());
    setDialogOpen(true);
  };

  const openEdit = (s: Supplier) => {
    setEditing(s);
    setForm({
      name: s.name,
      contact: s.contact ?? "",
      phone: s.phone ?? "",
      email: s.email ?? "",
      address: s.address ?? "",
      notes: s.notes ?? "",
    });
    setDialogOpen(true);
  };

  const save = async () => {
    const name = form.name.trim();
    if (!name) {
      toast.error("Supplier name is required");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name,
        contact: form.contact?.trim() || null,
        phone: form.phone?.trim() || null,
        email: form.email?.trim() || null,
        address: form.address?.trim() || null,
        notes: form.notes?.trim() || null,
      };
      if (editing) {
        const { error } = await supabase.from("suppliers").update(payload).eq("id", editing.id);
        if (error) throw error;
        toast.success("Supplier updated");
      } else {
        const { error } = await supabase.from("suppliers").insert(payload);
        if (error) throw error;
        toast.success("Supplier added");
      }
      setDialogOpen(false);
      qc.invalidateQueries({ queryKey: ["suppliers"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      const { error } = await supabase.from("suppliers").delete().eq("id", deleteTarget.id);
      if (error) throw error;
      toast.success("Supplier deleted");
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: ["suppliers"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete");
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-6 py-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Suppliers</h1>
          <p className="text-sm text-muted-foreground">
            Manage supplier list — used for autocomplete on purchase entry.
          </p>
        </div>
        <Button onClick={openNew}>
          <Plus className="h-4 w-4 mr-2" /> Add supplier
        </Button>
      </div>

      <Card className="p-4 space-y-4">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search suppliers…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Name</th>
                <th className="py-2 pr-4 font-medium">Contact</th>
                <th className="py-2 pr-4 font-medium">Phone</th>
                <th className="py-2 pr-4 font-medium">Email</th>
                <th className="py-2 pr-4 font-medium">Address</th>
                <th className="py-2 pr-4 font-medium w-24">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-muted-foreground">
                    <Loader2 className="h-4 w-4 inline animate-spin mr-2" /> Loading…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-muted-foreground">
                    {suppliers.length === 0 ? "No suppliers yet. Add your first one." : "No matches."}
                  </td>
                </tr>
              ) : (
                filtered.map((s) => (
                  <tr key={s.id} className="border-b hover:bg-accent/40">
                    <td className="py-2 pr-4 font-medium">{s.name}</td>
                    <td className="py-2 pr-4">{s.contact || "—"}</td>
                    <td className="py-2 pr-4">{s.phone || "—"}</td>
                    <td className="py-2 pr-4">{s.email || "—"}</td>
                    <td className="py-2 pr-4 max-w-[220px] truncate" title={s.address ?? ""}>
                      {s.address || "—"}
                    </td>
                    <td className="py-2 pr-4">
                      <div className="flex items-center gap-1">
                        <Button size="icon" variant="ghost" onClick={() => openEdit(s)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setDeleteTarget(s)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit supplier" : "Add supplier"}</DialogTitle>
            <DialogDescription>
              Suppliers here appear as autocomplete suggestions in Purchase Entry.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Field label="Name *" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
            <div className="grid grid-cols-2 gap-3">
              <Field
                label="Contact person"
                value={form.contact ?? ""}
                onChange={(v) => setForm({ ...form, contact: v })}
              />
              <Field
                label="Phone"
                value={form.phone ?? ""}
                onChange={(v) => setForm({ ...form, phone: v })}
              />
            </div>
            <Field label="Email" value={form.email ?? ""} onChange={(v) => setForm({ ...form, email: v })} />
            <div>
              <label className="text-xs font-medium text-muted-foreground">Address</label>
              <Textarea
                value={form.address ?? ""}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                rows={2}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Notes</label>
              <Textarea
                value={form.notes ?? ""}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              <X className="h-4 w-4 mr-2" /> Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete supplier?</DialogTitle>
            <DialogDescription>
              This will remove <span className="font-medium">{deleteTarget?.name}</span> from your
              supplier list. Existing purchase records are not affected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
