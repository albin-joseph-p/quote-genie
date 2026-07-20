import { useEffect, useRef, useState } from "react";
import { ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ZoomPanViewer({ src, alt }: { src: string; alt?: string }) {
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const dragRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const reset = () => { setScale(1); setTx(0); setTy(0); };
  useEffect(() => { reset(); }, [src]);

  const clampScale = (s: number) => Math.min(8, Math.max(0.2, s));

  const zoomAt = (delta: number, cx?: number, cy?: number) => {
    setScale((prev) => {
      const next = clampScale(prev * (delta > 0 ? 1.15 : 1 / 1.15));
      if (cx != null && cy != null && containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const ox = cx - rect.left - rect.width / 2;
        const oy = cy - rect.top - rect.height / 2;
        const ratio = next / prev;
        setTx((t) => ox - (ox - t) * ratio);
        setTy((t) => oy - (oy - t) * ratio);
      }
      return next;
    });
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    zoomAt(-e.deltaY, e.clientX, e.clientY);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, tx, ty };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    setTx(dragRef.current.tx + (e.clientX - dragRef.current.x));
    setTy(dragRef.current.ty + (e.clientY - dragRef.current.y));
  };
  const onPointerUp = () => { dragRef.current = null; };

  return (
    <div className="relative w-[90vw] h-[85vh] max-w-[1600px]">
      <div className="absolute top-2 right-2 z-10 flex gap-1 bg-background/90 backdrop-blur border rounded-lg p-1 shadow">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => zoomAt(-1)} title="Zoom out">
          <ZoomOut className="h-4 w-4" />
        </Button>
        <div className="px-2 flex items-center text-xs font-mono w-14 justify-center">
          {Math.round(scale * 100)}%
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => zoomAt(1)} title="Zoom in">
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={reset} title="Reset">
          <RotateCcw className="h-4 w-4" />
        </Button>
      </div>
      <div
        ref={containerRef}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="w-full h-full overflow-hidden rounded-md bg-muted/30 cursor-grab active:cursor-grabbing flex items-center justify-center touch-none"
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          className="max-w-full max-h-full w-auto h-auto object-contain select-none pointer-events-none"
          style={{ transform: `translate(${tx}px, ${ty}px) scale(${scale})`, transformOrigin: "center center" }}
        />
      </div>
    </div>
  );
}
