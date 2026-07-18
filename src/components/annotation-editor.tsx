import { useEffect, useRef, useState } from "react";
import { Trash2, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type AnnotationLabel = "Category" | "Brand" | "Item" | "Group End";

export const ANNOTATION_LABELS: AnnotationLabel[] = ["Category", "Brand", "Item", "Group End"];

export type Annotation = {
  id: string;
  label: AnnotationLabel;
  // Normalized (0-1) relative to the image's natural dimensions
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
};

const LABEL_COLORS: Record<AnnotationLabel, string> = {
  Category: "rgba(59,130,246,0.35)", // blue
  Brand: "rgba(16,185,129,0.35)", // green
  Item: "rgba(245,158,11,0.35)", // amber
  "Group End": "rgba(239,68,68,0.35)", // red
};

const LABEL_BORDER: Record<AnnotationLabel, string> = {
  Category: "#3b82f6",
  Brand: "#10b981",
  Item: "#f59e0b",
  "Group End": "#ef4444",
};

export function AnnotationEditor({
  open,
  onOpenChange,
  files,
  initial,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  files: File[];
  initial?: Record<number, Annotation[]>;
  onSubmit: (annotations: Record<number, Annotation[]>) => void;
}) {
  const [idx, setIdx] = useState(0);
  const [urls, setUrls] = useState<string[]>([]);
  const [annots, setAnnots] = useState<Record<number, Annotation[]>>(initial ?? {});
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const created = files.map((f) => URL.createObjectURL(f));
    setUrls(created);
    setIdx(0);
    setAnnots(initial ?? {});
    return () => {
      created.forEach((u) => URL.revokeObjectURL(u));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, files]);

  const current = annots[idx] ?? [];

  const setCurrent = (updater: (a: Annotation[]) => Annotation[]) => {
    setAnnots((m) => ({ ...m, [idx]: updater(m[idx] ?? []) }));
  };

  const relFromEvent = (e: React.PointerEvent) => {
    const el = imgRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const pt = relFromEvent(e);
    if (!pt) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragStart.current = pt;
    setDraft({ x: pt.x, y: pt.y, w: 0, h: 0 });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragStart.current) return;
    const pt = relFromEvent(e);
    if (!pt) return;
    const x = Math.min(dragStart.current.x, pt.x);
    const y = Math.min(dragStart.current.y, pt.y);
    const w = Math.abs(pt.x - dragStart.current.x);
    const h = Math.abs(pt.y - dragStart.current.y);
    setDraft({ x, y, w, h });
  };
  const onPointerUp = () => {
    if (!draft || !dragStart.current) {
      dragStart.current = null;
      setDraft(null);
      return;
    }
    dragStart.current = null;
    if (draft.w > 0.01 && draft.h > 0.01) {
      const newAnn: Annotation = {
        id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        label: "Item",
        ...draft,
      };
      setCurrent((a) => [...a, newAnn]);
    }
    setDraft(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-[95vw] p-0 overflow-hidden">
        <DialogHeader className="px-5 pt-4 pb-2">
          <DialogTitle>Annotate image {idx + 1} of {files.length}</DialogTitle>
          <DialogDescription>
            Drag on the image to draw a box, then classify it. Use <b>Group End</b> to mark
            where a group of items stops.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-[1fr_320px] gap-0 border-t max-h-[70vh]">
          {/* Image + overlay */}
          <div
            ref={containerRef}
            className="relative bg-muted/30 flex items-center justify-center overflow-auto p-3 select-none"
          >
            {urls[idx] && (
              <div className="relative inline-block">
                <img
                  ref={imgRef}
                  src={urls[idx]}
                  alt={files[idx]?.name}
                  draggable={false}
                  className="max-h-[65vh] max-w-full object-contain block cursor-crosshair"
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerUp}
                />
                {/* existing boxes */}
                {current.map((a) => (
                  <div
                    key={a.id}
                    className="absolute pointer-events-none flex items-start"
                    style={{
                      left: `${a.x * 100}%`,
                      top: `${a.y * 100}%`,
                      width: `${a.w * 100}%`,
                      height: `${a.h * 100}%`,
                      background: LABEL_COLORS[a.label],
                      border: `2px solid ${LABEL_BORDER[a.label]}`,
                    }}
                  >
                    <span
                      className="text-[10px] font-semibold px-1 py-0.5 text-white"
                      style={{ background: LABEL_BORDER[a.label] }}
                    >
                      {a.label}
                    </span>
                  </div>
                ))}
                {draft && (
                  <div
                    className="absolute pointer-events-none"
                    style={{
                      left: `${draft.x * 100}%`,
                      top: `${draft.y * 100}%`,
                      width: `${draft.w * 100}%`,
                      height: `${draft.h * 100}%`,
                      border: "2px dashed #3b82f6",
                      background: "rgba(59,130,246,0.15)",
                    }}
                  />
                )}
              </div>
            )}
          </div>

          {/* Annotation list */}
          <div className="border-l bg-card overflow-y-auto p-3 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Annotations ({current.length})
            </p>
            {current.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Drag on the image to mark a region.
              </p>
            )}
            {current.map((a, i) => (
              <div key={a.id} className="border rounded-md p-2 space-y-1.5 bg-background">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-muted-foreground w-5">#{i + 1}</span>
                  <Select
                    value={a.label}
                    onValueChange={(v) =>
                      setCurrent((xs) =>
                        xs.map((x) => (x.id === a.id ? { ...x, label: v as AnnotationLabel } : x)),
                      )
                    }
                  >
                    <SelectTrigger className="h-8 text-xs flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ANNOTATION_LABELS.map((l) => (
                        <SelectItem key={l} value={l} className="text-xs">
                          {l}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <button
                    onClick={() =>
                      setCurrent((xs) => xs.filter((x) => x.id !== a.id))
                    }
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                {a.label !== "Group End" && (
                  <Input
                    placeholder="Optional: text in this box"
                    value={a.text ?? ""}
                    onChange={(e) =>
                      setCurrent((xs) =>
                        xs.map((x) =>
                          x.id === a.id ? { ...x, text: e.target.value } : x,
                        ),
                      )
                    }
                    className="h-8 text-xs"
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        <DialogFooter className="px-5 py-3 border-t flex-row items-center sm:justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={idx === 0}
              onClick={() => setIdx((i) => Math.max(0, i - 1))}
            >
              <ChevronLeft className="h-4 w-4 mr-1" /> Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={idx >= files.length - 1}
              onClick={() => setIdx((i) => Math.min(files.length - 1, i + 1))}
            >
              Next <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={() => onSubmit(annots)}>Process with annotations</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
