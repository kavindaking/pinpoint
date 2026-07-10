import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { frameCount, type RadCase } from "../types";

export interface ViewerPoint {
  x: number;
  y: number;
}

/**
 * The central film viewer. The container is sized to the image's exact
 * aspect ratio (capped by width and viewport height), the current slice
 * fills it, and an SVG overlay shares the same box with a natural-pixel
 * viewBox. Pointer events map 1:1 to normalized (0..1) image coordinates,
 * independent of display size.
 *
 * Multi-slice stacks (CT/MRI) are navigated with the mouse wheel or the
 * side slider; every pointer and overlay callback carries the active slice
 * so scoring and drawing stay slice-aware. Single images behave exactly as
 * before with the stack chrome hidden.
 */
export function ImageViewer({
  radCase,
  overlay,
  onImageSize,
  onTap,
  onDrag,
  onSlice,
  jumpTo,
  cursor = "default",
  maxHeight = "72vh",
}: {
  radCase: RadCase;
  /** Overlay factory: receives the natural image size and the active slice. */
  overlay?: (w: number, h: number, slice: number) => ReactNode;
  onImageSize?: (w: number, h: number) => void;
  onTap?: (p: ViewerPoint, slice: number) => void;
  /** Down / move / up in normalized coords plus active slice, for the editor. */
  onDrag?: {
    down?: (p: ViewerPoint, slice: number) => void;
    move?: (p: ViewerPoint, slice: number) => void;
    up?: (p: ViewerPoint, slice: number) => void;
  };
  onSlice?: (slice: number) => void;
  /** When set to a slice index, the viewer jumps there (e.g. on reveal). */
  jumpTo?: number | null;
  cursor?: string;
  maxHeight?: string;
}) {
  const frames = frameCount(radCase);
  const [srcs, setSrcs] = useState<string[]>([]);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [slice, setSlice] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const downAt = useRef<{ x: number; y: number } | null>(null);
  const wheelAcc = useRef(0);

  // Resolve every frame to a displayable URL; revoke object URLs on change.
  useEffect(() => {
    setSize(null);
    setSlice(0);
    onSlice?.(0);
    if (radCase.imageBlobs?.length) {
      const urls = radCase.imageBlobs.map((b) => URL.createObjectURL(b));
      setSrcs(urls);
      return () => urls.forEach((u) => URL.revokeObjectURL(u));
    }
    if (radCase.imageUrls?.length) {
      setSrcs(radCase.imageUrls);
      return;
    }
    if (radCase.imageBlob) {
      const url = URL.createObjectURL(radCase.imageBlob);
      setSrcs([url]);
      return () => URL.revokeObjectURL(url);
    }
    setSrcs(radCase.imageUrl ? [radCase.imageUrl] : []);
    // onSlice identity is stable enough; excluding it avoids reset loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radCase]);

  const changeSlice = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(frames - 1, next));
      setSlice((cur) => {
        if (clamped !== cur) onSlice?.(clamped);
        return clamped;
      });
    },
    [frames, onSlice],
  );

  // Jump to a requested slice (e.g. Play jumping to the finding on reveal).
  useEffect(() => {
    if (typeof jumpTo === "number") changeSlice(jumpTo);
  }, [jumpTo, changeSlice]);

  // Wheel scrubs through the stack. Attached natively so it can preventDefault
  // (React's onWheel is passive and cannot stop the page from scrolling).
  useEffect(() => {
    const el = containerRef.current;
    if (!el || frames <= 1) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      wheelAcc.current += e.deltaY;
      const step = 24;
      while (Math.abs(wheelAcc.current) >= step) {
        const dir = wheelAcc.current > 0 ? 1 : -1;
        wheelAcc.current -= dir * step;
        setSlice((cur) => {
          const next = Math.max(0, Math.min(frames - 1, cur + dir));
          if (next !== cur) onSlice?.(next);
          return next;
        });
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [frames, onSlice]);

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
    onDrag?.down?.(p, slice);
  };

  const handleMove = (e: PointerEvent) => {
    if (!downAt.current || !onDrag?.move) return;
    const p = toNormalized(e);
    if (p) onDrag.move(p, slice);
  };

  const handleUp = (e: PointerEvent) => {
    const p = toNormalized(e);
    const start = downAt.current;
    downAt.current = null;
    if (!p || !start) return;
    onDrag?.up?.(p, slice);
    // A tap is a press without meaningful travel.
    if (onTap && Math.hypot(p.x - start.x, p.y - start.y) < 0.01) onTap(p, slice);
  };

  const isStackView = frames > 1;
  // Preload neighbours so scrubbing does not flash.
  const preload = useMemo(() => {
    const set = new Set<number>();
    for (let d = -2; d <= 2; d++) {
      const i = slice + d;
      if (i >= 0 && i < srcs.length) set.add(i);
    }
    return set;
  }, [slice, srcs.length]);

  return (
    <div className="mx-auto flex items-stretch gap-2" style={{ width: size ? `min(100%, calc(${maxHeight} * ${size.w / size.h} + ${isStackView ? 2.25 : 0}rem))` : "100%" }}>
      <div
        ref={containerRef}
        className="relative min-w-0 flex-1 overflow-hidden rounded-(--radius-panel) border border-line bg-black"
        style={size ? { aspectRatio: `${size.w} / ${size.h}` } : { minHeight: "16rem" }}
      >
        {srcs.map((s, i) => (
          <img
            key={s}
            src={preload.has(i) || i === slice ? s : undefined}
            data-src={s}
            alt={i === slice ? `${radCase.modality}, slice ${i + 1} of ${frames}` : ""}
            draggable={false}
            onLoad={(e) => {
              if (size) return;
              const img = e.currentTarget;
              if (img.naturalWidth) {
                setSize({ w: img.naturalWidth, h: img.naturalHeight });
                onImageSize?.(img.naturalWidth, img.naturalHeight);
              }
            }}
            className="absolute inset-0 block h-full w-full select-none"
            style={{ opacity: i === slice ? 1 : 0 }}
          />
        ))}
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
            {overlay?.(size.w, size.h, slice)}
          </svg>
        )}
        {isStackView && (
          <div className="pointer-events-none absolute left-2 top-2 rounded-(--radius-ctl) bg-black/55 px-2 py-1 font-mono text-xs text-white/90">
            {slice + 1} / {frames}
          </div>
        )}
      </div>

      {isStackView && size && (
        <div className="flex w-7 shrink-0 flex-col items-center gap-1.5 py-1">
          <input
            type="range"
            min={0}
            max={frames - 1}
            value={slice}
            onChange={(e) => changeSlice(Number(e.target.value))}
            aria-label="Slice"
            className="slice-slider"
            style={{ height: "100%" }}
          />
        </div>
      )}
    </div>
  );
}
