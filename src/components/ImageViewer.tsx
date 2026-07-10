import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import type { RadCase } from "../types";

export interface ViewerPoint {
  x: number;
  y: number;
}

/**
 * The central film viewer. The container is sized to the image's exact
 * aspect ratio (capped by width and viewport height), the image fills it,
 * and an SVG overlay shares the same box with a natural-pixel viewBox.
 * Pointer events therefore map 1:1 to normalized (0..1) image coordinates,
 * independent of display size.
 */
export function ImageViewer({
  radCase,
  overlay,
  onImageSize,
  onTap,
  onDrag,
  cursor = "default",
  maxHeight = "72vh",
}: {
  radCase: RadCase;
  /** Overlay factory: receives the natural image size. */
  overlay?: (w: number, h: number) => ReactNode;
  onImageSize?: (w: number, h: number) => void;
  onTap?: (p: ViewerPoint) => void;
  /** Down / move / up in normalized coords, for the region editor. */
  onDrag?: {
    down?: (p: ViewerPoint) => void;
    move?: (p: ViewerPoint) => void;
    up?: (p: ViewerPoint) => void;
  };
  cursor?: string;
  maxHeight?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const downAt = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    setSize(null);
    if (radCase.imageBlob) {
      const url = URL.createObjectURL(radCase.imageBlob);
      setSrc(url);
      return () => URL.revokeObjectURL(url);
    }
    setSrc(radCase.imageUrl ?? null);
  }, [radCase]);

  const toNormalized = useCallback((e: PointerEvent): ViewerPoint | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;
    return { x, y };
  }, []);

  const handleDown = (e: PointerEvent) => {
    const p = toNormalized(e);
    if (!p) return;
    svgRef.current?.setPointerCapture(e.pointerId);
    downAt.current = p;
    onDrag?.down?.(p);
  };

  const handleMove = (e: PointerEvent) => {
    if (!downAt.current || !onDrag?.move) return;
    const p = toNormalized(e);
    if (p) onDrag.move(p);
  };

  const handleUp = (e: PointerEvent) => {
    const p = toNormalized(e);
    const start = downAt.current;
    downAt.current = null;
    if (!p || !start) return;
    onDrag?.up?.(p);
    // A tap is a press without meaningful travel.
    if (onTap && Math.hypot(p.x - start.x, p.y - start.y) < 0.01) onTap(p);
  };

  return (
    <div
      className="relative mx-auto overflow-hidden rounded-(--radius-panel) border border-line bg-black"
      style={
        size
          ? {
              aspectRatio: `${size.w} / ${size.h}`,
              width: `min(100%, calc(${maxHeight} * ${size.w / size.h}))`,
            }
          : { width: "100%", minHeight: "16rem" }
      }
    >
      {src && (
        <img
          src={src}
          alt={`${radCase.modality} of the ${radCase.bodyRegion.toLowerCase()}`}
          draggable={false}
          onLoad={(e) => {
            const img = e.currentTarget;
            setSize({ w: img.naturalWidth, h: img.naturalHeight });
            onImageSize?.(img.naturalWidth, img.naturalHeight);
          }}
          className="block h-full w-full select-none"
        />
      )}
      {size && (
        <svg
          ref={svgRef}
          viewBox={`0 0 ${size.w} ${size.h}`}
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full touch-none"
          style={{ cursor }}
          onPointerDown={handleDown}
          onPointerMove={handleMove}
          onPointerUp={handleUp}
        >
          {overlay?.(size.w, size.h)}
        </svg>
      )}
    </div>
  );
}
