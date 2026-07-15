import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { frameCount, type RadCase } from "../types";
import { CompressedDicomError, parseDicomFrames, renderToImageData, type DicomImage } from "../lib/dicom";
import { withImageRetry } from "../lib/image";
import { ArrowsIn, CircleHalf, MagnifyingGlassMinus, MagnifyingGlassPlus } from "./icons";

export interface ViewerPoint {
  x: number;
  y: number;
}

const ZOOM_MIN = 1;
const ZOOM_MAX = 8;

/**
 * CSS typed arithmetic (`calc(72vh * 1.2)`) is not supported consistently by
 * Safari. Scale the simple length in JavaScript so the browser receives an
 * ordinary value such as `86.4vh`.
 */
function scaleCssLength(length: string, factor: number): string {
  const match = length.trim().match(/^([0-9]*\.?[0-9]+)([a-z%]+)$/i);
  if (!match) return length;
  return `${Number(match[1]) * factor}${match[2]}`;
}

/**
 * The central film viewer. The container is sized to the image's exact
 * aspect ratio (capped by width and viewport height), the current slice
 * fills it, and an SVG overlay shares the same box with a natural-pixel
 * viewBox. Pointer events map 1:1 to normalized (0..1) image coordinates,
 * independent of display size.
 *
 * Two source kinds render into the same viewport:
 *   - PNG/JPG frames (single image or an uploaded stack) drawn as <img>;
 *   - DICOM series (`dicomUrls`) parsed with dicom-parser and drawn to a
 *     <canvas> with true window/level, exactly like the Viewer tab. DICOM
 *     carries square pixel spacing, so the head renders at its real
 *     proportions rather than a stretched export.
 *
 * `pacs` turns on a reading-room viewport: zoom (ctrl+scroll or the
 * toolbar), pan by dragging while zoomed, window/level on right-drag
 * (brightness/contrast for images, real center/width for DICOM), invert,
 * and, for DICOM, an HU readout under the cursor. The image/canvas and the
 * SVG overlay share one transformed wrapper, so click coordinates, and with
 * them the scoring, stay exact at any zoom or pan.
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
  const dicomUrls = radCase.dicomUrls;
  const dicomBlobs = radCase.dicomBlobs;
  const dicomMode = !!(dicomUrls?.length || dicomBlobs?.length);

  const [srcs, setSrcs] = useState<string[]>([]);
  const [imageRetryTokens, setImageRetryTokens] = useState<Record<string, string>>({});
  const [failedImages, setFailedImages] = useState<Set<string>>(() => new Set());
  const [flatRevision, setFlatRevision] = useState(0);
  const [dicom, setDicom] = useState<DicomImage[] | null>(null);
  const [dicomError, setDicomError] = useState<string | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [slice, setSlice] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [bright, setBright] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [invert, setInvert] = useState(false);
  const [center, setCenter] = useState(40);
  const [width, setWidth] = useState(160);
  const [hu, setHu] = useState<{ value: number; unit: string } | null>(null);
  const frames = dicom?.length ?? frameCount(radCase);

  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const flatFramesRef = useRef<Map<number, { image: HTMLImageElement; src: string }>>(new Map());
  const idRef = useRef<ImageData | null>(null);
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

  // Resolve the source frames. DICOM series are fetched and parsed; image
  // frames become object URLs / static paths. Object URLs are revoked on
  // change.
  useEffect(() => {
    setSize(null);
    setSlice(0);
    onSlice?.(0);
    resetView();
    resetTone();
    setHu(null);
    setDicom(null);
    setDicomError(null);
    setImageRetryTokens({});
    setFailedImages(new Set());
    flatFramesRef.current.clear();
    setFlatRevision((revision) => revision + 1);
    idRef.current = null;

    if (dicomUrls?.length || dicomBlobs?.length) {
      let cancelled = false;
      (async () => {
        try {
          const frames: DicomImage[] = [];
          let compressed = false;
          const sources: (string | Blob)[] = [...(dicomUrls ?? []), ...(dicomBlobs ?? [])];
          for (const source of sources) {
            try {
              if (typeof source === "string") {
                const res = await fetch(source);
                if (!res.ok) continue;
                frames.push(...parseDicomFrames(await res.arrayBuffer()));
              } else {
                frames.push(...parseDicomFrames(await source.arrayBuffer()));
              }
            } catch (err) {
              if (err instanceof CompressedDicomError) compressed = true;
            }
          }
          if (cancelled) return;
          if (frames.length === 0) {
            setDicomError(compressed ? "This DICOM series is compressed and cannot be shown." : "Could not read this DICOM series.");
            return;
          }
          frames.sort((a, b) => a.instanceNumber - b.instanceNumber);
          const first = frames[0];
          setDicom(frames);
          setCenter(first.windowCenter);
          setWidth(first.windowWidth);
          setInvert(first.invert);
          setSize({ w: first.cols, h: first.rows });
          onImageSize?.(first.cols, first.rows);
        } catch {
          if (!cancelled) setDicomError("Could not load this DICOM series.");
        }
      })();
      return () => {
        cancelled = true;
      };
    }

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

  // Draw the active DICOM slice with the current window into the canvas. The
  // canvas is sized to the image's native pixels and stretched by CSS to the
  // aspect-matched container, so no anamorphic distortion is introduced.
  useEffect(() => {
    if (!dicomMode || !dicom) return;
    const frame = dicom[slice];
    const cvs = canvasRef.current;
    if (!frame || !cvs) return;
    if (cvs.width !== frame.cols || cvs.height !== frame.rows) {
      cvs.width = frame.cols;
      cvs.height = frame.rows;
      idRef.current = null;
    }
    const ctx = cvs.getContext("2d");
    if (!ctx) return;
    let id = idRef.current;
    if (!id || id.width !== frame.cols) {
      id = ctx.createImageData(frame.cols, frame.rows);
      idRef.current = id;
    }
    renderToImageData(frame, center, width, invert, id);
    ctx.putImageData(id, 0, 0);
  }, [dicomMode, dicom, slice, center, width, invert]);

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

  const zoomBy = useCallback((factor: number) => {
    setZoom((z) => {
      const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z * factor));
      if (next === 1) setPan({ x: 0, y: 0 });
      return next;
    });
  }, []);

  // Wheel scrubs the stack; ctrl+wheel (and trackpad pinch, reported as
  // ctrl+wheel) zooms in PACS mode. Native listener so it can preventDefault.
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

  const readHu = useCallback(
    (e: PointerEvent) => {
      if (!dicomMode || !dicom) return;
      const frame = dicom[slice];
      const p = toNormalized(e);
      if (!frame || !p) {
        setHu(null);
        return;
      }
      const px = Math.floor(p.x * frame.cols);
      const py = Math.floor(p.y * frame.rows);
      if (px < 0 || px >= frame.cols || py < 0 || py >= frame.rows) {
        setHu(null);
        return;
      }
      setHu({ value: frame.pixels[py * frame.cols + px], unit: frame.rescaleUnit });
    },
    [dicomMode, dicom, slice, toNormalized],
  );

  const handleDown = (e: PointerEvent) => {
    if (pacs && e.button === 2) {
      // Right-drag adjusts the window (level/brightness, width/contrast).
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
      if (dicomMode) {
        setWidth((w) => Math.max(1, w + dx * 2));
        setCenter((c) => c - dy * 2);
      } else {
        setBright((b) => Math.max(20, Math.min(300, b - dy * 0.6)));
        setContrast((c) => Math.max(20, Math.min(300, c + dx * 0.6)));
      }
      return;
    }
    if (!downAt.current) {
      readHu(e);
      return;
    }
    // Dragging while zoomed pans the viewport (outside the region editor).
    if (pacs && !onDrag && zoom > 1 && lastClient.current) {
      const dx = e.clientX - lastClient.current.x;
      const dy = e.clientY - lastClient.current.y;
      lastClient.current = { x: e.clientX, y: e.clientY };
      setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
      return;
    }
    if (!onDrag?.move) {
      readHu(e);
      return;
    }
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
    // so panning cannot count as a tap.
    const clientTravel = startClient ? Math.hypot(e.clientX - startClient.x, e.clientY - startClient.y) : 0;
    if (onTap && clientTravel < 5 && Math.hypot(p.x - start.x, p.y - start.y) < 0.01) {
      onTap(p, slice);
    }
  };

  const isStackView = frames > 1;
  const toneAdjusted = dicomMode
    ? dicom != null && (Math.round(center) !== Math.round(dicom[0].windowCenter) || Math.round(width) !== Math.round(dicom[0].windowWidth) || invert !== dicom[0].invert)
    : bright !== 100 || contrast !== 100 || invert;
  const imageMaxWidth = size ? scaleCssLength(maxHeight, size.w / size.h) : null;
  const viewerMaxWidth = imageMaxWidth
    ? isStackView
      ? `calc(${imageMaxWidth} + 2.25rem)`
      : imageMaxWidth
    : undefined;
  // Preload neighbours so scrubbing images does not flash.
  const preload = useMemo(() => {
    const set = new Set<number>();
    for (let d = -2; d <= 2; d++) {
      const i = slice + d;
      if (i >= 0 && i < srcs.length) set.add(i);
    }
    return set;
  }, [slice, srcs.length]);

  const retryImage = useCallback((src: string) => {
    setFailedImages((current) => {
      const next = new Set(current);
      next.delete(src);
      return next;
    });
    setImageRetryTokens((current) => ({ ...current, [src]: `${Date.now()}` }));
  }, []);

  const handleImageError = useCallback((src: string) => {
    if (!imageRetryTokens[src]) {
      setImageRetryTokens((current) => ({ ...current, [src]: `${Date.now()}` }));
      return;
    }
    setFailedImages((failed) => new Set(failed).add(src));
  }, [imageRetryTokens]);

  // WebKit can drop an absolutely positioned <img> after its surrounding
  // aspect-ratio/filter layers update. Decode flat frames off-DOM and paint
  // them into the same stable canvas used by the DICOM viewer instead.
  useEffect(() => {
    if (dicomMode) return;
    let cancelled = false;

    for (const i of preload) {
      const source = srcs[i];
      if (!source) continue;
      const resolved = withImageRetry(source, imageRetryTokens[source]);
      if (flatFramesRef.current.get(i)?.src === resolved) continue;

      const image = new Image();
      image.decoding = "async";
      image.onload = () => {
        if (cancelled) return;
        flatFramesRef.current.set(i, { image, src: resolved });
        setFailedImages((current) => {
          if (!current.has(source)) return current;
          const next = new Set(current);
          next.delete(source);
          return next;
        });
        setFlatRevision((revision) => revision + 1);
      };
      image.onerror = () => {
        if (!cancelled) handleImageError(source);
      };
      image.src = resolved;
    }

    return () => {
      cancelled = true;
    };
  }, [dicomMode, handleImageError, imageRetryTokens, preload, srcs]);

  useEffect(() => {
    if (dicomMode) return;
    const frame = flatFramesRef.current.get(slice)?.image;
    const canvas = canvasRef.current;
    if (!frame || !canvas) return;

    if (canvas.width !== frame.naturalWidth || canvas.height !== frame.naturalHeight) {
      canvas.width = frame.naturalWidth;
      canvas.height = frame.naturalHeight;
    }
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = zoom <= 2;
    context.drawImage(frame, 0, 0, canvas.width, canvas.height);

    if (!size || size.w !== frame.naturalWidth || size.h !== frame.naturalHeight) {
      setSize({ w: frame.naturalWidth, h: frame.naturalHeight });
      onImageSize?.(frame.naturalWidth, frame.naturalHeight);
    }
    // Callback identities are intentionally excluded: painting only depends
    // on the decoded frame, active slice and canvas-affecting zoom state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dicomMode, flatRevision, slice, zoom]);

  const pacsButton =
    "pointer-events-auto flex size-7 cursor-pointer items-center justify-center rounded-[6px] bg-black/55 text-white/85 transition-colors hover:bg-black/75 hover:text-white";

  return (
    <div
      className="mx-auto flex w-full items-stretch gap-2"
      style={{ maxWidth: viewerMaxWidth }}
    >
      <div
        ref={containerRef}
        className="relative min-w-0 flex-1 overflow-hidden rounded-(--radius-panel) border border-line bg-black"
        style={size ? { aspectRatio: `${size.w} / ${size.h}` } : { minHeight: "16rem" }}
        onContextMenu={pacs ? (e) => e.preventDefault() : undefined}
      >
        {/* Image/canvas and overlay share one transform so clicks stay calibrated. */}
        <div
          className="absolute inset-0"
          style={
            zoom !== 1 || pan.x !== 0 || pan.y !== 0
              ? {
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                  transformOrigin: "center",
                }
              : undefined
          }
        >
          <canvas
            ref={canvasRef}
            role="img"
            aria-label={`${radCase.modality}, slice ${slice + 1} of ${frames}`}
            className="absolute inset-0 block h-full w-full select-none"
            style={{
              imageRendering: zoom > 2 ? "pixelated" : "auto",
              filter:
                !dicomMode && toneAdjusted
                  ? `brightness(${bright / 100}) contrast(${contrast / 100}) invert(${invert ? 1 : 0})`
                  : undefined,
            }}
          />
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
              onPointerLeave={() => setHu(null)}
            >
              {overlay?.(size.w, size.h, slice)}
            </svg>
          )}
        </div>

        {/* Viewport chrome, outside the transform */}
        {dicomError && (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-white/70">
            {dicomError}
          </div>
        )}
        {dicomMode && !dicom && !dicomError && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-white/60">
            Loading series…
          </div>
        )}
        {!dicomMode && srcs[slice] && failedImages.has(srcs[slice]) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-sm text-white/70">
            <span>This image could not be loaded.</span>
            <button
              type="button"
              onClick={() => retryImage(srcs[slice])}
              className="cursor-pointer rounded-(--radius-ctl) border border-white/20 bg-white/10 px-3 py-1.5 text-white hover:bg-white/15"
            >
              Try again
            </button>
          </div>
        )}
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
        {pacs && dicomMode && dicom && (
          <button
            type="button"
            onClick={() => {
              setCenter(dicom[0].windowCenter);
              setWidth(dicom[0].windowWidth);
              setInvert(dicom[0].invert);
            }}
            title="Reset window/level"
            className={`absolute bottom-2 left-2 rounded-(--radius-ctl) bg-black/55 px-2 py-1 text-left font-mono text-[11px] leading-tight text-white/85 ${
              toneAdjusted ? "cursor-pointer hover:bg-black/75" : "pointer-events-none"
            }`}
          >
            <div>W {Math.round(width)} · L {Math.round(center)}</div>
            {hu && (
              <div className="text-white/60">
                {Math.round(hu.value)}
                {hu.unit && ` ${hu.unit}`}
              </div>
            )}
          </button>
        )}
        {pacs && !dicomMode && toneAdjusted && (
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
