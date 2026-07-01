import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Search, Eye, RefreshCw, Trash2, ImageIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/history")({
  head: () => ({
    meta: [
      { title: "Quotation History — Orion Sales Corporation" },
      { name: "description", content: "Browse, search and reopen previously processed customer quotations." },
    ],
  }),
  component: HistoryPage,
});

type QuoteItem = {
  extractedText: string;
  itemCode: string | null;
  category: string | null;
  qty: number;
};

type Quote = {
  id: string;
  customer_name: string;
  image_urls: string[];
  items: QuoteItem[];
  item_count: number;
  created_at: string;
};

function HistoryPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [viewing, setViewing] = useState<Quote | null>(null);
  const [zoomUrl, setZoomUrl] = useState<string | null>(null);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});

  const listQ = useQuery({
    queryKey: ["quotations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quotations")
        .select("id,customer_name,image_urls,items,item_count,created_at")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as Quote[];
    },
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("quotations").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Quotation deleted");
      qc.invalidateQueries({ queryKey: ["quotations"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return listQ.data ?? [];
    return (listQ.data ?? []).filter((r) => {
      const name = (r.customer_name || "").toLowerCase();
      const date = new Date(r.created_at).toLocaleString().toLowerCase();
      return name.includes(q) || date.includes(q);
    });
  }, [listQ.data, search]);

  const openView = async (q: Quote) => {
    setViewing(q);
    if (q.image_urls.length > 0) {
      const { data, error } = await supabase.storage
        .from("quotation-images")
        .createSignedUrls(q.image_urls, 60 * 60);
      if (!error && data) {
        const map: Record<string, string> = {};
        data.forEach((d, i) => {
          if (d.signedUrl) map[q.image_urls[i]] = d.signedUrl;
        });
        setSignedUrls(map);
      }
    }
  };

  const reuse = (q: Quote) => {
    sessionStorage.setItem(
      "reuse-quotation",
      JSON.stringify({ customer_name: q.customer_name, items: q.items }),
    );
    navigate({ to: "/" });
  };

  return (
    <div className="mx-auto max-w-7xl px-6 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Quotation History</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Every processed quotation is archived here with its original images and extracted items.
        </p>
      </div>

      <Card className="p-4">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by customer name or date…"
            className="pl-9"
          />
        </div>
      </Card>

      <Card className="p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="text-left p-3 font-medium">Date & Time</th>
              <th className="text-left p-3 font-medium">Customer</th>
              <th className="text-left p-3 font-medium">Items</th>
              <th className="text-left p-3 font-medium">Summary</th>
              <th className="text-left p-3 font-medium w-16">Images</th>
              <th className="text-right p-3 font-medium w-56">Actions</th>
            </tr>
          </thead>
          <tbody>
            {listQ.isLoading && (
              <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">Loading…</td></tr>
            )}
            {!listQ.isLoading && filtered.length === 0 && (
              <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No quotations yet.</td></tr>
            )}
            {filtered.map((q) => {
              const summary = q.items
                .slice(0, 3)
                .map((it) => it.extractedText)
                .filter(Boolean)
                .join(", ");
              const more = q.items.length > 3 ? ` +${q.items.length - 3} more` : "";
              return (
                <tr key={q.id} className="border-t hover:bg-muted/30">
                  <td className="p-3 whitespace-nowrap">{new Date(q.created_at).toLocaleString()}</td>
                  <td className="p-3 font-medium">{q.customer_name || <span className="text-muted-foreground italic">Unnamed</span>}</td>
                  <td className="p-3"><Badge variant="secondary">{q.item_count}</Badge></td>
                  <td className="p-3 text-muted-foreground max-w-md truncate" title={summary + more}>
                    {summary}{more}
                  </td>
                  <td className="p-3">
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <ImageIcon className="h-3 w-3" /> {q.image_urls.length}
                    </span>
                  </td>
                  <td className="p-3 text-right space-x-1">
                    <Button variant="ghost" size="sm" onClick={() => openView(q)}>
                      <Eye className="h-4 w-4 mr-1" /> View
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => reuse(q)}>
                      <RefreshCw className="h-4 w-4 mr-1" /> Reuse
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => del.mutate(q.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <Dialog open={!!viewing} onOpenChange={(o) => { if (!o) { setViewing(null); setSignedUrls({}); } }}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-auto">
          <DialogTitle>
            {viewing?.customer_name || "Unnamed"}{" "}
            <span className="text-sm font-normal text-muted-foreground">
              · {viewing && new Date(viewing.created_at).toLocaleString()}
            </span>
          </DialogTitle>
          {viewing && (
            <div className="space-y-4">
              {viewing.image_urls.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold mb-2">Original Images</h3>
                  <div className="flex flex-wrap gap-2">
                    {viewing.image_urls.map((path) => (
                      <button
                        key={path}
                        onClick={() => signedUrls[path] && setZoomUrl(signedUrls[path])}
                        className="group"
                      >
                        {signedUrls[path] ? (
                          <img
                            src={signedUrls[path]}
                            alt="quote"
                            className="h-32 w-32 object-cover rounded border group-hover:ring-2 group-hover:ring-primary"
                          />
                        ) : (
                          <div className="h-32 w-32 rounded border flex items-center justify-center bg-muted text-xs text-muted-foreground">
                            Loading…
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <h3 className="text-sm font-semibold mb-2">Extracted Items ({viewing.items.length})</h3>
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="text-left p-2">Extracted Text</th>
                        <th className="text-left p-2">Item Code</th>
                        <th className="text-left p-2">Category</th>
                        <th className="text-left p-2 w-16">Qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {viewing.items.map((it, i) => (
                        <tr key={i} className="border-t">
                          <td className="p-2">{it.extractedText}</td>
                          <td className="p-2 font-mono text-xs">{it.itemCode ?? "—"}</td>
                          <td className="p-2 text-muted-foreground">{it.category ?? "—"}</td>
                          <td className="p-2">{it.qty}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!zoomUrl} onOpenChange={(o) => !o && setZoomUrl(null)}>
        <DialogContent className="max-w-[95vw] w-fit p-2">
          <DialogTitle className="sr-only">Image preview</DialogTitle>
          {zoomUrl && (
            <div className="overflow-auto max-h-[85vh]">
              <img src={zoomUrl} alt="preview" className="max-w-none h-auto" style={{ minWidth: "min(95vw, 1200px)" }} />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
