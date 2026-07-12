import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { frameCount, type RadCase } from "../types";
import { ArrowsIn, CircleHalf, MagnifyingGlassMinus, MagnifyingGlassPlus } from "./icons";

export interface ViewerPoint {
  x: number;
  y: number;
}

const ZOOM_MIN = 1;
const ZOOM_MAX = 8;

/**
 * The central film viewer. The container is sized to the image's exact
 * aspect ratio (capped by width and viewport height), the current slice
 * fills it, and an SVG overlay shares the same box with a natural-pixel
 * viewBox. Pointer events map 1:1 to normalized (0..1) image coordinates,
 * independent of display size.
 *
 * Multi-slice stacks (CT/MRI) are navigated with the mouse wheel or the
 * side slider; every pointer and overlay callback carries the active slice
 * so scoring and drawing stay slice-aware.
 *
 * `pacs` turns on a reading-room viewport: zoom (ctrl+scroll or pinch, or
 * the toolbar), pan by dragging while zoomed, windowing-style brightness
 * and contrast on right-drag, and invert. The image and the SVG overlay
 * share one transformed wrapper, so normalized click coordinates, and with
 * them the scoring, stay exact at any zoom or pan. The tonal filter is
 * applied to the images only, so revealed regions keep their true colors.
 */
export function ImageViewer({
  radCase,
  overlay,
  onImageSize,
  onTap,
  onDrag,
  onSlice,
  jumpTo,
  pacs = false,
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
  /** PACS-style viewport: zoom, pan, windowing drag, invert. */
  pacs?: boolean;
  cursor?: string;
  maxHeight?: string;
}) {
  const frames = frameCount(radCase);
  const [srcs, setSrcs] = useState<string[]>([]);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [slice, setSlice] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [bright, setBright] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [invert, setInvert] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const downAt = useRef<{ x: number; y: number } | null>(null);
  const downClient = useRef<{ x: number; y: number } | null>(null);
  const lastClient = useRef<{ x: number; y: number } | null>(null);
  const windowing = useRef(false);
  const wheelAcc = useRef(0);

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const resetTone = useCallback(() => {
    setBright(100);
    setContrast(100);
    setInvert(false);
  }, []);

  // Resolve every frame to a displayable URL; revoke object URLs on change.
  useEffect(() => {
    setSize(null);
    setSlice(0);
    onSlice?.(0);
    resetView();
    resetTone();
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
    // Callback identities are stable enough; excluding them avoids reset loops.
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

  // Jump to a requested slice (e.g. Play jumping to the finding on reveal),
  // and bring the whole frame back into view so the reveal is visible.
  useEffect(() => {
    if (typeof jumpTo === "number") {
      changeSlice(jumpTo);
      resetView();
    }
  }, [jumpTo, changeSlice, resetView]);

  const zoomBy = useCallback(
    (factor: number) => {
      setZoom((z) => {
        const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z * factor));
        if (next === 1) setPan({ x: 0, y: 0 });
        return next;
      });
    },
    [],
  );

  // Wheel scrubs through the stack; ctrl+wheel (and trackpad pinch, which
  // browsers report as ctrl+wheel) zooms in PACS mode. Attached natively so
  // it can preventDefault (React's onWheel is passive).
  useEffect(() => {
    const el = containerRef.current;
    if (!el || (frames <= 1 && !pacs)) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (pacs && (e.ctrlKey || e.metaKey)) {
        zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15);
        return;
      }
      if (frames <= 1) return;
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
  }, [frames, onSlice, pacs, zoomBy]);

  const toNormalized = useCallback((e: PointerEvent): ViewerPoint | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    // The rect reflects the pan/zoom transform, so this stays exact.
    const rect = svg.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;
    return { x, y };
  }, []);

  const handleDown = (e: PointerEvent) => {
    if (pacs && e.button === 2) {
      // Right-drag adjusts the window (brightness/contrast).
      windowing.current = true;
      lastClient.current = { x: e.clientX, y: e.clientY };
      svgRef.current?.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    const p = toNormalized(e);
    if (!p) return;
    svgRef.current?.setPointerCapture(e.pointerId);
    downAt.current = p;
    downClient.current = { x: e.clientX, y: e.clientY };
    lastClient.current = { x: e.clientX, y: e.clientY };
    onDrag?.down?.(p, slice);
  };

  const handleMove = (e: PointerEvent) => {
    if (windowing.current && lastClient.current) {
      const dx = e.clientX - lastClient.current.x;
      const dy = e.clientY - lastClient.current.y;
      lastClient.current = { x: e.clientX, y: e.clientY };
      setBright((b) => Math.max(20, Math.min(300, b - dy * 0.6)));
      setContrast((c) => Math.max(20, Math.min(300, c + dx * 0.6)));
      return;
    }
    if (!downAt.current) return;
    // Dragging while zoomed pans the viewport (only when nobody else wants
    // the drag, i.e. outside the region editor).
    if (pacs && !onDrag && zoom > 1 && lastClient.current) {
      const dx = e.clientX - lastClient.current.x;
      const dy = e.clientY - lastClient.current.y;
      lastClient.current = { x: e.clientX, y: e.clientY };
      setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
      return;
    }
    if (!onDrag?.move) return;
    const p = toNormalized(e);
    if (p) onDrag.move(p, slice);
  };

  const handleUp = (e: PointerEvent) => {
    if (windowing.current) {
      windowing.current = false;
      lastClient.current = null;
      return;
    }
    const p = toNormalized(e);
    const start = downAt.current;
    const startClient = downClient.current;
    downAt.current = null;
    downClient.current = null;
    lastClient.current = null;
    if (!p || !start) return;
    onDrag?.up?.(p, slice);
    // A tap is a press without meaningful travel, measured in screen pixels
    // so panning (where the image follows the cursor) cannot count as a tap.
    const clientTravel = startClient
      ? Math.hypot(e.clientX - startClient.x, e.clientY - startClient.y)
      : 0;
    if (onTap && clientTravel < 5 && Math.hypot(p.x - start.x, p.y - start.y) < 0.01) {
      onTap(p, slice);
    }
  };

  const isStackView = frames > 1;
  const toneAdjusted = bright !== 100 || contrast !== 100 || invert;
  // Preload neighbours so scrubbing does not flash.
  const preload = useMemo(() => {
    const set = new Set<number>();
    for (let d = -2; d <= 2; d++) {
      const i = slice + d;
      if (i >= 0 && i < srcs.length) set.add(i);
    }
    return set;
  }, [slice, srcs.length]);

  const pacsButton =
    "pointer-events-auto flex size-7 cursor-pointer items-center justify-center rounded-[6px] bg-black/55 text-white/85 transition-colors hover:bg-black/75 hover:text-white";

  return (
    <div className="mx-auto flex items-stretch gap-2" style={{ width: size ? `min(100%, calc(${maxHeight} * ${size.w / size.h} + ${isStackView ? 2.25 : 0}rem))` : "100%" }}>
      <div
        ref={containerRef}
        className="relative min-w-0 flex-1 overflow-hidden rounded-(--radius-panel) border border-line bg-black"
        style={size ? { aspectRatio: `${size.w} / ${size.h}` } : { minHeight: "16rem" }}
        onContextMenu={pacs ? (e) => e.preventDefault() : undefined}
      >
        {/* Image and overlay share one transform so clicks stay calibrated. */}
        <div
          className="absolute inset-0"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "center",
          }}
        >
          <div
            className="absolute inset-0"
            style={{
              filter: `brightness(${bright / 100}) contrast(${contrast / 100}) invert(${invert ? 1 : 0})`,
            }}
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
          </div>
          {size && (
            <svg
              ref={svgRef}
              viewBox={`0 0 ${size.w} ${size.h}`}
              preserveAspectRatio="none"
              className="absolute inset-0 h-full w-full touch-none"
              style={{ cursor: pacs && zoom > 1 && !onDrag ? "grab" : cursor }}
              onPointerDown={handleDown}
              onPointerMove={handleMove}
              onPointerUp={handleUp}
            >
              {overlay?.(size.w, size.h, slice)}
            </svg>
          )}
        </div>

        {/* Viewport chrome, outside the transform */}
        {isStackView && (
          <div className="pointer-events-none absolute left-2 top-2 rounded-(--radius-ctl) bg-black/55 px-2 py-1 font-mono text-xs text-white/90">
            {slice + 1} / {frames}
          </div>
        )}
        {pacs && zoom !== 1 && (
          <div className="pointer-events-none absolute right-2 top-2 rounded-(--radius-ctl) bg-black/55 px-2 py-1 font-mono text-xs text-white/90">
            {Math.round(zoom * 100)}%
          </div>
        )}
        {pacs && toneAdjusted && (
          <button
            type="button"
            onClick={resetTone}
            title="Reset window (brightness/contrast)"
            className="absolute bottom-2 left-2 cursor-pointer rounded-(--radius-ctl) bg-black/55 px-2 py-1 font-mono text-xs text-white/90 transition-colors hover:bg-black/75"
          >
            B {Math.round(bright)} C {Math.round(contrast)}
            {invert && " inv"}
          </button>
        )}
        {pacs && (
          <div className="pointer-events-none absolute bottom-2 right-2 flex items-center gap-1">
            <button type="button" className={pacsButton} title="Zoom in (ctrl+scroll)" aria-label="Zoom in" onClick={() => zoomBy(1.25)}>
              <MagnifyingGlassPlus size={15} />
            </button>
            <button type="button" className={pacsButton} title="Zoom out" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.25)}>
              <MagnifyingGlassMinus size={15} />
            </button>
            <button type="button" className={pacsButton} title="Fit to viewport" aria-label="Fit to viewport" onClick={resetView}>
              <ArrowsIn size={15} />
            </button>
            <button
              type="button"
              className={pacsButton + (invert ? " !bg-white/85 !text-black" : "")}
              title="Invert grayscale"
              aria-label="Invert grayscale"
              onClick={() => setInvert((v) => !v)}
            >
              <CircleHalf size={15} weight="fill" />
            </button>
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
