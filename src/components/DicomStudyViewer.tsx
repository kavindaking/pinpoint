import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
import {
  CircleHalf,
  CornersOut,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
} from "./icons";
import type { ViewerPoint } from "./ImageViewer";
import type { RadCase } from "../types";
import {
  CompressedDicomError,
  parseDicom,
  renderToImageData,
  WL_PRESETS,
  type DicomImage,
} from "../lib/dicom";

interface View {
  center: number;
  width: number;
  invert: boolean;
  zoom: number;
  panX: number;
  panY: number;
}

interface ScreenGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

type Drag =
  | null
  | {
      mode: "wl" | "pan" | "tap";
      x: number;
      y: number;
      startCenter: number;
      startWidth: number;
      startPanX: number;
      startPanY: number;
      point: ViewerPoint | null;
    };

/**
 * The original Sample Viewer viewport, shared only by real DICOM studies.
 * Its canvas always fits the image inside a fixed-height black viewport,
 * preserving the source aspect ratio. Quiz overlays are positioned over the
 * fitted image rectangle rather than stretched across the viewport.
 */
export function DicomStudyViewer({
  images,
  onImageSize,
  onTap,
  jumpTo,
  overlay,
  cursor = "crosshair",
  height = "64vh",
}: {
  images: DicomImage[];
  onImageSize?: (w: number, h: number) => void;
  onTap?: (point: ViewerPoint, slice: number) => void;
  jumpTo?: number | null;
  overlay?: (w: number, h: number, slice: number) => ReactNode;
  cursor?: string;
  height?: string;
}) {
  const [slice, setSlice] = useState(0);
  const [view, setView] = useState<View>(() => initialView(images[0]));
  const [hoverHU, setHoverHU] = useState<{ value: number; unit: string } | null>(null);
  const [screenGeometry, setScreenGeometry] = useState<ScreenGeometry | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const offRef = useRef<HTMLCanvasElement | null>(null);
  const idRef = useRef<ImageData | null>(null);
  const drag = useRef<Drag>(null);

  const img = images[slice];

  const geometry = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !img) return null;
    const fit = Math.min(canvas.width / img.cols, canvas.height / img.rows);
    const scale = fit * view.zoom;
    const drawW = img.cols * scale;
    const drawH = img.rows * scale;
    const x = (canvas.width - drawW) / 2 + view.panX;
    const y = (canvas.height - drawH) / 2 + view.panY;
    return { scale, x, y, drawW, drawH };
  }, [img, view.panX, view.panY, view.zoom]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const dpr = window.devicePixelRatio || 1;
    const width = Math.round(wrap.clientWidth * dpr);
    const heightPx = Math.round(wrap.clientHeight * dpr);
    if (canvas.width !== width || canvas.height !== heightPx) {
      canvas.width = width;
      canvas.height = heightPx;
    }
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#000";
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (!img) return;

    const offscreen = (offRef.current ??= document.createElement("canvas"));
    if (offscreen.width !== img.cols || offscreen.height !== img.rows) {
      offscreen.width = img.cols;
      offscreen.height = img.rows;
      idRef.current = null;
    }
    const offscreenContext = offscreen.getContext("2d")!;
    let imageData = idRef.current;
    if (!imageData) {
      imageData = offscreenContext.createImageData(img.cols, img.rows);
      idRef.current = imageData;
    }
    renderToImageData(img, view.center, view.width, view.invert, imageData);
    offscreenContext.putImageData(imageData, 0, 0);

    const g = geometry();
    if (!g) return;
    context.imageSmoothingEnabled = false;
    context.drawImage(offscreen, g.x, g.y, g.drawW, g.drawH);
    const next = {
      x: g.x / dpr,
      y: g.y / dpr,
      width: g.drawW / dpr,
      height: g.drawH / dpr,
    };
    setScreenGeometry((current) =>
      current &&
      Math.abs(current.x - next.x) < 0.1 &&
      Math.abs(current.y - next.y) < 0.1 &&
      Math.abs(current.width - next.width) < 0.1 &&
      Math.abs(current.height - next.height) < 0.1
        ? current
        : next,
    );
  }, [geometry, img, view.center, view.invert, view.width]);

  useEffect(draw, [draw]);

  useEffect(() => {
    const onResize = () => draw();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [draw]);

  useEffect(() => {
    const first = images[0];
    setSlice(0);
    setView(initialView(first));
    setScreenGeometry(null);
    idRef.current = null;
    if (first) onImageSize?.(first.cols, first.rows);
    // The image array identifies a newly loaded study.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images]);

  useEffect(() => {
    if (typeof jumpTo !== "number") return;
    setSlice(Math.max(0, Math.min(images.length - 1, jumpTo)));
    setView((current) => ({ ...current, zoom: 1, panX: 0, panY: 0 }));
  }, [images.length, jumpTo]);

  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        setView((current) => ({
          ...current,
          zoom: Math.max(0.5, Math.min(8, current.zoom * (event.deltaY > 0 ? 0.9 : 1.1))),
        }));
      } else {
        setSlice((current) =>
          Math.max(0, Math.min(images.length - 1, current + (event.deltaY > 0 ? 1 : -1))),
        );
      }
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [images.length]);

  const pointFromEvent = (event: PointerEvent): ViewerPoint | null => {
    const canvas = canvasRef.current;
    const g = geometry();
    if (!canvas || !g || !img) return null;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const x = ((event.clientX - rect.left) * dpr - g.x) / g.drawW;
    const y = ((event.clientY - rect.top) * dpr - g.y) / g.drawH;
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;
    return { x, y };
  };

  const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!img) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const quizTap = !!onTap && event.button === 0 && !event.shiftKey && !event.altKey;
    const pan = event.button === 1 || event.shiftKey || event.altKey;
    drag.current = {
      mode: quizTap ? "tap" : pan ? "pan" : "wl",
      x: event.clientX,
      y: event.clientY,
      startCenter: view.center,
      startWidth: view.width,
      startPanX: view.panX,
      startPanY: view.panY,
      point: quizTap ? pointFromEvent(event) : null,
    };
  };

  const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const g = geometry();
    const canvas = canvasRef.current;
    if (g && canvas && img) {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const px = ((event.clientX - rect.left) * dpr - g.x) / g.scale;
      const py = ((event.clientY - rect.top) * dpr - g.y) / g.scale;
      if (px >= 0 && px < img.cols && py >= 0 && py < img.rows) {
        setHoverHU({
          value: img.pixels[Math.floor(py) * img.cols + Math.floor(px)],
          unit: img.rescaleUnit,
        });
      } else {
        setHoverHU(null);
      }
    }

    const current = drag.current;
    if (!current || current.mode === "tap") return;
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    if (current.mode === "wl") {
      setView((value) => ({
        ...value,
        width: Math.max(1, current.startWidth + dx * 2),
        center: current.startCenter - dy * 2,
      }));
    } else {
      const dpr = window.devicePixelRatio || 1;
      setView((value) => ({
        ...value,
        panX: current.startPanX + dx * dpr,
        panY: current.startPanY + dy * dpr,
      }));
    }
  };

  const handlePointerUp = (event: PointerEvent<HTMLCanvasElement>) => {
    const current = drag.current;
    drag.current = null;
    if (!current || current.mode !== "tap" || !current.point || !onTap) return;
    if (Math.hypot(event.clientX - current.x, event.clientY - current.y) < 5) {
      onTap(current.point, slice);
    }
  };

  const resetView = () => img && setView(initialView(img));

  if (!img) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {WL_PRESETS.map((preset) => (
          <button
            key={preset.name}
            type="button"
            onClick={() =>
              setView((current) => ({
                ...current,
                center: preset.center,
                width: preset.width,
              }))
            }
            className={`cursor-pointer rounded-(--radius-ctl) border px-2.5 py-1 text-xs transition-colors ${
              Math.round(view.center) === preset.center && Math.round(view.width) === preset.width
                ? "border-accent bg-accent-soft text-ink"
                : "border-line text-ink-dim hover:border-line-strong hover:text-ink"
            }`}
          >
            {preset.name}
          </button>
        ))}
        <div className="mx-1 h-5 w-px bg-(--border)" />
        <button
          type="button"
          onClick={() => setView((current) => ({ ...current, invert: !current.invert }))}
          className={`flex cursor-pointer items-center gap-1.5 rounded-(--radius-ctl) border px-2.5 py-1 text-xs transition-colors ${
            view.invert
              ? "border-accent bg-accent-soft text-ink"
              : "border-line text-ink-dim hover:border-line-strong"
          }`}
        >
          <CircleHalf size={14} />
          Invert
        </button>
        <button
          type="button"
          onClick={() => setView((current) => ({ ...current, zoom: Math.min(8, current.zoom * 1.2) }))}
          className="flex cursor-pointer items-center rounded-(--radius-ctl) border border-line px-2 py-1 text-ink-dim transition-colors hover:border-line-strong hover:text-ink"
          aria-label="Zoom in"
        >
          <MagnifyingGlassPlus size={14} />
        </button>
        <button
          type="button"
          onClick={() => setView((current) => ({ ...current, zoom: Math.max(0.5, current.zoom / 1.2) }))}
          className="flex cursor-pointer items-center rounded-(--radius-ctl) border border-line px-2 py-1 text-ink-dim transition-colors hover:border-line-strong hover:text-ink"
          aria-label="Zoom out"
        >
          <MagnifyingGlassMinus size={14} />
        </button>
        <button
          type="button"
          onClick={resetView}
          className="flex cursor-pointer items-center gap-1.5 rounded-(--radius-ctl) border border-line px-2.5 py-1 text-xs text-ink-dim transition-colors hover:border-line-strong hover:text-ink"
        >
          <CornersOut size={14} />
          Reset
        </button>
      </div>

      <div className="flex items-stretch gap-2">
        <div
          ref={wrapRef}
          className="relative min-w-0 flex-1 overflow-hidden rounded-(--radius-panel) border border-line bg-black"
          style={{ height }}
        >
          <canvas
            ref={canvasRef}
            className="h-full w-full touch-none"
            style={{ cursor }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={() => {
              drag.current = null;
              setHoverHU(null);
            }}
            onContextMenu={(event) => event.preventDefault()}
          />
          {screenGeometry && overlay && (
            <svg
              viewBox={`0 0 ${img.cols} ${img.rows}`}
              preserveAspectRatio="none"
              className="pointer-events-none absolute"
              style={{
                left: screenGeometry.x,
                top: screenGeometry.y,
                width: screenGeometry.width,
                height: screenGeometry.height,
              }}
            >
              {overlay(img.cols, img.rows, slice)}
            </svg>
          )}
          <div className="pointer-events-none absolute left-3 top-2 font-mono text-[11px] leading-tight text-white/80">
            <div>{img.patientName || "Anonymous"}</div>
            <div className="text-white/60">{img.seriesDescription || img.modality}</div>
          </div>
          <div className="pointer-events-none absolute right-3 top-2 text-right font-mono text-[11px] leading-tight text-white/80">
            <div>{slice + 1} / {images.length}</div>
            {img.sliceLocation != null && (
              <div className="text-white/60">{img.sliceLocation.toFixed(1)} mm</div>
            )}
          </div>
          <div className="pointer-events-none absolute bottom-2 left-3 font-mono text-[11px] leading-tight text-white/80">
            <div>W {Math.round(view.width)} · L {Math.round(view.center)}</div>
            <div className="text-white/60">
              Zoom {view.zoom.toFixed(1)}×
              {hoverHU && (
                <>
                  {" · "}
                  {Math.round(hoverHU.value)}
                  {hoverHU.unit && ` ${hoverHU.unit}`}
                </>
              )}
            </div>
          </div>
          <div className="pointer-events-none absolute bottom-2 right-3 max-w-[45%] text-right font-mono text-[10.5px] leading-tight text-white/45">
            {onTap
              ? "click: answer · right-drag: window/level · shift-drag: pan · wheel: scroll"
              : "drag: window/level · shift-drag: pan · wheel: scroll · ⌘/ctrl-wheel: zoom"}
          </div>
        </div>

        {images.length > 1 && (
          <input
            type="range"
            min={0}
            max={images.length - 1}
            value={slice}
            onChange={(event) => setSlice(Number(event.target.value))}
            aria-label="Slice"
            className="slice-slider"
            style={{ height }}
          />
        )}
      </div>
    </div>
  );
}

/** Load a case's DICOM sources, then render them in the Sample Viewer. */
export function DicomCaseViewer({
  radCase,
  onImageSize,
  onTap,
  jumpTo,
  overlay,
  cursor,
}: {
  radCase: RadCase;
  onImageSize?: (w: number, h: number) => void;
  onTap?: (point: ViewerPoint, slice: number) => void;
  jumpTo?: number | null;
  overlay?: (w: number, h: number, slice: number) => ReactNode;
  cursor?: string;
  pacs?: boolean;
}) {
  const [images, setImages] = useState<DicomImage[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setImages([]);
    setError(null);
    (async () => {
      const parsed: DicomImage[] = [];
      let compressed = false;
      const sources: (string | Blob)[] = [
        ...(radCase.dicomUrls ?? []),
        ...(radCase.dicomBlobs ?? []),
      ];
      for (const source of sources) {
        try {
          const buffer =
            typeof source === "string"
              ? await (await fetch(source)).arrayBuffer()
              : await source.arrayBuffer();
          parsed.push(parseDicom(buffer));
        } catch (err) {
          if (err instanceof CompressedDicomError) compressed = true;
        }
      }
      if (cancelled) return;
      if (parsed.length === 0) {
        setError(
          compressed
            ? "This DICOM series is compressed and cannot be shown."
            : "Could not read this DICOM series.",
        );
        return;
      }
      parsed.sort((a, b) => a.instanceNumber - b.instanceNumber);
      setImages(parsed);
    })();
    return () => {
      cancelled = true;
    };
  }, [radCase]);

  if (error) {
    return (
      <div className="flex min-h-80 items-center justify-center rounded-(--radius-panel) border border-line bg-black p-6 text-center text-sm text-white/70">
        {error}
      </div>
    );
  }
  if (images.length === 0) {
    return (
      <div className="flex min-h-80 items-center justify-center rounded-(--radius-panel) border border-line bg-black text-sm text-white/60">
        Loading series…
      </div>
    );
  }
  return (
    <DicomStudyViewer
      images={images}
      onImageSize={onImageSize}
      onTap={onTap}
      jumpTo={jumpTo}
      overlay={overlay}
      cursor={cursor}
    />
  );
}

function initialView(image: DicomImage | undefined): View {
  return {
    center: image?.windowCenter ?? 40,
    width: image?.windowWidth ?? 400,
    invert: image?.invert ?? false,
    zoom: 1,
    panX: 0,
    panY: 0,
  };
}
