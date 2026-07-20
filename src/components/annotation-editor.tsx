import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Trash2, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize2, Hand, Maximize, Minimize } from "lucide-react";
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

export type AnnotationLabel = "Category" | "Brand" | "Item" | "Quantity" | "Group End" | "Exclude";

export const ANNOTATION_LABELS: AnnotationLabel[] = ["Category", "Brand", "Item", "Quantity", "Group End", "Exclude"];

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
  Quantity: "rgba(168,85,247,0.35)", // purple
  "Group End": "rgba(239,68,68,0.35)", // red
  Exclude: "rgba(17,24,39,0.75)", // near-black mask
};

const LABEL_BORDER: Record<AnnotationLabel, string> = {
  Category: "#3b82f6",
  Brand: "#10b981",
  Item: "#f59e0b",
  Quantity: "#a855f7",
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

  // zoom + pan
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [panMode, setPanMode] = useState(false);
  const panStart = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const spaceDown = useRef(false);

  // resizable dialog
  const [dims, setDims] = useState<{ w: number; h: number }>(() => ({
    w: typeof window !== "undefined" ? Math.round(window.innerWidth * 0.96) : 1200,
    h: typeof window !== "undefined" ? Math.round(window.innerHeight * 0.96) : 800,
  }));
  const [maximized, setMaximized] = useState(true);
  const resizeStart = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const onResizeDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    resizeStart.current = { x: e.clientX, y: e.clientY, w: dims.w, h: dims.h };
    setMaximized(false);
    e.preventDefault();
    e.stopPropagation();
  };
  const onResizeMove = (e: React.PointerEvent) => {
    if (!resizeStart.current) return;
    const nw = Math.max(560, Math.min(window.innerWidth, resizeStart.current.w + (e.clientX - resizeStart.current.x)));
    const nh = Math.max(420, Math.min(window.innerHeight, resizeStart.current.h + (e.clientY - resizeStart.current.y)));
    setDims({ w: nw, h: nh });
  };
  const onResizeUp = () => {
    resizeStart.current = null;
  };
  const toggleMaximize = () => {
    if (maximized) {
      setDims({ w: Math.round(window.innerWidth * 0.7), h: Math.round(window.innerHeight * 0.7) });
      setMaximized(false);
    } else {
      setDims({ w: Math.round(window.innerWidth * 0.96), h: Math.round(window.innerHeight * 0.96) });
      setMaximized(true);
    }
  };

  const resetView = () => {
    fitToContainer();
  };

  const fitToContainer = () => {
    const img = imgRef.current;
    const cont = containerRef.current;
    if (!img || !cont) return;
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    if (!iw || !ih) return;
    const padding = 24;
    const cw = Math.max(1, cont.clientWidth - padding);
    const ch = Math.max(1, cont.clientHeight - padding);
    if (!cw || !ch) return;
    const s = Math.min(4, cw / iw, ch / ih);
    setScale(s);
    setTx((cont.clientWidth - iw * s) / 2);
    setTy((cont.clientHeight - ih * s) / 2);
  };


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

  useEffect(() => {
    resetView();
  }, [idx, open]);

  useEffect(() => {
    if (!open || !containerRef.current) return;
    const frame = window.requestAnimationFrame(fitToContainer);
    const observer = new ResizeObserver(() => fitToContainer());
    observer.observe(containerRef.current);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [open, idx, urls[idx]]);

  useEffect(() => {
    if (!open) return;
    const kd = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        spaceDown.current = true;
      }
    };
    const ku = (e: KeyboardEvent) => {
      if (e.code === "Space") spaceDown.current = false;
    };
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    return () => {
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
    };
  }, [open]);

  const current = annots[idx] ?? [];

  const setCurrent = (updater: (a: Annotation[]) => Annotation[]) => {
    setAnnots((m) => ({ ...m, [idx]: updater(m[idx] ?? []) }));
  };

  const validateAnnotations = (list: Annotation[]) => {
    const items = list.filter((a) => a.label === "Item").length;
    const qty = list.filter((a) => a.label === "Quantity").length;
    const groupEnds = list.filter((a) => a.label === "Group End").length;
    const closable = list.filter(
      (a) => a.label === "Category" || a.label === "Brand" || a.label === "Item",
    ).length;
    if (closable > 0 && groupEnds < closable) {
      return `Add a "Group End" marker for every Category / Brand / Item (need ${closable}, have ${groupEnds}).`;
    }
    if (items !== qty) {
      return `Each Item needs a matching Quantity annotation (items: ${items}, quantities: ${qty}).`;
    }
    return null;
  };

  const handleSubmit = () => {
    for (let i = 0; i < files.length; i++) {
      const list = annots[i] ?? [];
      if (list.length === 0) continue;
      const err = validateAnnotations(list);
      if (err) {
        setIdx(i);
        toast.error(`Image ${i + 1}: ${err}`);
        return;
      }
    }
    onSubmit(annots);
  };

  const relFromEvent = (e: React.PointerEvent) => {
    const el = imgRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
  };

  const isPanGesture = (e: React.PointerEvent) =>
    panMode || spaceDown.current || e.button === 1 || e.button === 2;

  const onPointerDown = (e: React.PointerEvent) => {
    if (isPanGesture(e)) {
      (e.target as Element).setPointerCapture?.(e.pointerId);
      panStart.current = { x: e.clientX, y: e.clientY, tx, ty };
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;
    const pt = relFromEvent(e);
    if (!pt) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragStart.current = pt;
    setDraft({ x: pt.x, y: pt.y, w: 0, h: 0 });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (panStart.current) {
      setTx(panStart.current.tx + (e.clientX - panStart.current.x));
      setTy(panStart.current.ty + (e.clientY - panStart.current.y));
      return;
    }
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
    if (panStart.current) {
      panStart.current = null;
      return;
    }
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

  const onWheel = (e: React.WheelEvent) => {
    if (!containerRef.current) return;
    e.preventDefault();
    const rect = containerRef.current.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const delta = -e.deltaY;
    const factor = delta > 0 ? 1.1 : 1 / 1.1;
    const newScale = Math.min(8, Math.max(0.2, scale * factor));
    const k = newScale / scale;
    // zoom toward cursor
    setTx(cx - (cx - tx) * k);
    setTy(cy - (cy - ty) * k);
    setScale(newScale);
  };

  const zoomBy = (factor: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const newScale = Math.min(8, Math.max(0.2, scale * factor));
    const k = newScale / scale;
    setTx(cx - (cx - tx) * k);
    setTy(cy - (cy - ty) * k);
    setScale(newScale);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="p-0 overflow-hidden !flex flex-col !gap-0 !max-w-none"
        style={{ width: dims.w, height: dims.h, maxWidth: "100vw", maxHeight: "100vh" }}
      >
        <DialogHeader className="shrink-0 px-5 pt-4 pb-2 pr-20 relative">
          <DialogTitle>Annotate image {idx + 1} of {files.length}</DialogTitle>
          <DialogDescription>
            Drag to draw a box. Scroll to zoom, hold <b>Space</b> or use the hand tool to pan.
            Every <b>Category</b>, <b>Brand</b>, and <b>Item</b> must be closed with a <b>Group End</b>.
            Each <b>Item</b> also needs a paired <b>Quantity</b> annotation.
          </DialogDescription>
          <button
            type="button"
            onClick={toggleMaximize}
            title={maximized ? "Restore" : "Maximize"}
            className="absolute right-12 top-4 rounded-sm p-1 text-muted-foreground hover:bg-muted"
          >
            {maximized ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
          </button>
        </DialogHeader>



        <div className="grid w-full min-w-0 flex-1 min-h-0 grid-cols-[48px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)_170px] gap-0 border-t md:grid-cols-[48px_minmax(0,1fr)_320px] md:grid-rows-1">
          {/* Tool rail */}
          <div className="z-10 flex min-h-0 shrink-0 flex-col items-center gap-1 border-r bg-background/95 p-2">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => zoomBy(1 / 1.2)} title="Zoom out">
              <ZoomOut className="h-3.5 w-3.5" />
            </Button>
            <span className="w-full rounded-sm bg-muted px-1 py-1 text-center font-mono text-[10px] tabular-nums">
              {Math.round(scale * 100)}%
            </span>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => zoomBy(1.2)} title="Zoom in">
              <ZoomIn className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={resetView} title="Reset view">
              <Maximize2 className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant={panMode ? "default" : "ghost"}
              size="icon"
              className="h-8 w-8"
              onClick={() => setPanMode((p) => !p)}
              title="Pan mode (or hold Space)"
            >
              <Hand className="h-3.5 w-3.5" />
            </Button>
          </div>

          {/* Image + overlay */}
          <div
            ref={containerRef}
            className="relative h-full w-full min-w-0 min-h-0 overflow-hidden bg-muted/30 select-none touch-none"

            onWheel={onWheel}
            onContextMenu={(e) => e.preventDefault()}
          >
            {urls[idx] && (
              <div
                className="absolute top-0 left-0 origin-top-left"
                style={{
                  transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
                }}
              >
                <div className="relative inline-block">
                  <img
                    ref={imgRef}
                    src={urls[idx]}
                    alt={files[idx]?.name}
                    draggable={false}
                    onLoad={fitToContainer}
                    className={`block max-w-none ${
                      panMode || spaceDown.current ? "cursor-grab" : "cursor-crosshair"
                    }`}
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
              </div>
            )}
          </div>

          {/* Annotation list */}
          <div className="col-span-2 min-h-0 overflow-y-auto border-t bg-card p-3 space-y-2 md:col-span-1 md:border-l md:border-t-0">
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

        <DialogFooter className="shrink-0 px-5 py-3 border-t flex-row items-center sm:justify-between gap-2">
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
            <Button onClick={handleSubmit}>Process with annotations</Button>
          </div>
        </DialogFooter>
        <div
          onPointerDown={onResizeDown}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeUp}
          onPointerCancel={onResizeUp}
          title="Drag to resize"
          className="absolute bottom-0 right-0 z-50 h-4 w-4 cursor-nwse-resize"
          style={{
            background:
              "linear-gradient(135deg, transparent 0 55%, hsl(var(--muted-foreground)/0.6) 55% 60%, transparent 60% 70%, hsl(var(--muted-foreground)/0.6) 70% 75%, transparent 75%)",
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
