import { useCallback, useEffect, useRef, useState } from "react";
import {
  CircleHalf,
  CornersOut,
  Cube,
  FilePlus,
  FolderOpen,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
  Stack,
  Warning,
} from "../components/icons";
import type { RadCase } from "../types";
import { CompressedDicomError, parseDicom, renderToImageData, WL_PRESETS, type DicomImage } from "../lib/dicom";
import { Button } from "../components/ui";

interface View {
  center: number;
  width: number;
  invert: boolean;
  zoom: number;
  panX: number;
  panY: number;
}

type Drag = null | { mode: "wl" | "pan"; x: number; y: number; startCenter: number; startWidth: number; startPanX: number; startPanY: number };

/**
 * A lightweight PACS-style DICOM viewer. Loads uncompressed .dcm files,
 * renders the active slice to a canvas with window/level, and supports the
 * core reading-room interactions: wheel-scroll through the stack, left-drag
 * to window/level, pan, zoom, presets, and invert. Series can be imported as
 * a personal case to annotate in the game.
 */
export function Viewer({ onImportSeries }: { onImportSeries: (draft: RadCase) => void }) {
  const [images, setImages] = useState<DicomImage[]>([]);
  const [slice, setSlice] = useState(0);
  const [view, setView] = useState<View>({ center: 40, width: 400, invert: false, zoom: 1, panX: 0, panY: 0 });
  const [hoverHU, setHoverHU] = useState<{ value: number; unit: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const offRef = useRef<HTMLCanvasElement | null>(null);
  const idRef = useRef<ImageData | null>(null);
  const drag = useRef<Drag>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const img = images[slice];

  // Compute the mapping from screen to image pixels for the current draw.
  const geom = useCallback(() => {
    const cvs = canvasRef.current;
    if (!cvs || !img) return null;
    const fit = Math.min(cvs.width / img.cols, cvs.height / img.rows);
    const scale = fit * view.zoom;
    const drawW = img.cols * scale;
    const drawH = img.rows * scale;
    const x = (cvs.width - drawW) / 2 + view.panX;
    const y = (cvs.height - drawH) / 2 + view.panY;
    return { scale, x, y, drawW, drawH };
  }, [img, view.zoom, view.panX, view.panY]);

  const draw = useCallback(() => {
    const cvs = canvasRef.current;
    const wrap = wrapRef.current;
    if (!cvs || !wrap) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = wrap.clientWidth;
    const ch = wrap.clientHeight;
    if (cvs.width !== Math.round(cw * dpr) || cvs.height !== Math.round(ch * dpr)) {
      cvs.width = Math.round(cw * dpr);
      cvs.height = Math.round(ch * dpr);
    }
    const ctx = cvs.getContext("2d")!;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, cvs.width, cvs.height);
    if (!img) return;

    const off = (offRef.current ??= document.createElement("canvas"));
    if (off.width !== img.cols || off.height !== img.rows) {
      off.width = img.cols;
      off.height = img.rows;
      idRef.current = null;
    }
    const octx = off.getContext("2d")!;
    let id = idRef.current;
    if (!id) {
      id = octx.createImageData(img.cols, img.rows);
      idRef.current = id;
    }
    renderToImageData(img, view.center, view.width, view.invert, id);
    octx.putImageData(id, 0, 0);

    const g = geom();
    if (!g) return;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, g.x, g.y, g.drawW, g.drawH);
  }, [img, view.center, view.width, view.invert, geom]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    const onResize = () => draw();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [draw]);

  // Wheel scrubs the stack; ctrl/cmd-wheel zooms.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        setView((v) => ({ ...v, zoom: Math.max(0.5, Math.min(8, v.zoom * (e.deltaY > 0 ? 0.9 : 1.1))) }));
      } else {
        setSlice((s) => Math.max(0, Math.min(images.length - 1, s + (e.deltaY > 0 ? 1 : -1))));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [images.length]);

  const loadFiles = useCallback(async (files: File[]) => {
    const dcm = files.filter((f) => f.name.toLowerCase().endsWith(".dcm") || f.type === "application/dicom");
    const chosen = dcm.length ? dcm : files;
    if (chosen.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const parsed: DicomImage[] = [];
      let compressed = false;
      for (const f of chosen) {
        try {
          parsed.push(parseDicom(await f.arrayBuffer()));
        } catch (err) {
          if (err instanceof CompressedDicomError) compressed = true;
        }
      }
      if (parsed.length === 0) {
        setError(
          compressed
            ? "These files use compressed pixel data, which this viewer does not decode. Export them as uncompressed DICOM and try again."
            : "No readable DICOM images found in the selection.",
        );
        return;
      }
      parsed.sort((a, b) => a.instanceNumber - b.instanceNumber);
      setImages(parsed);
      setSlice(0);
      const first = parsed[0];
      setView({ center: first.windowCenter, width: first.windowWidth, invert: first.invert, zoom: 1, panX: 0, panY: 0 });
      if (compressed) {
        setError(`${parsed.length} slices loaded. Some slices were skipped because they were compressed.`);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSample = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const files: File[] = [];
      for (let i = 1; i <= 10; i++) {
        const name = `ct-head-${String(i).padStart(2, "0")}.dcm`;
        const res = await fetch(`/samples/dicom/${name}`);
        if (!res.ok) continue;
        files.push(new File([await res.blob()], name, { type: "application/dicom" }));
      }
      if (files.length === 0) {
        setError("Sample series is unavailable.");
        return;
      }
      await loadFiles(files);
    } finally {
      setLoading(false);
    }
  }, [loadFiles]);

  const applyPreset = (center: number, width: number) => setView((v) => ({ ...v, center, width }));
  const resetView = () =>
    img &&
    setView((v) => ({ ...v, center: img.windowCenter, width: img.windowWidth, invert: img.invert, zoom: 1, panX: 0, panY: 0 }));

  const onPointerDown = (e: React.PointerEvent) => {
    if (!img) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    const pan = e.button === 1 || e.shiftKey || e.altKey;
    drag.current = {
      mode: pan ? "pan" : "wl",
      x: e.clientX,
      y: e.clientY,
      startCenter: view.center,
      startWidth: view.width,
      startPanX: view.panX,
      startPanY: view.panY,
    };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    // Hover HU readout
    const g = geom();
    const cvs = canvasRef.current;
    if (g && cvs && img) {
      const rect = cvs.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const px = ((e.clientX - rect.left) * dpr - g.x) / g.scale;
      const py = ((e.clientY - rect.top) * dpr - g.y) / g.scale;
      if (px >= 0 && px < img.cols && py >= 0 && py < img.rows) {
        const val = img.pixels[Math.floor(py) * img.cols + Math.floor(px)];
        setHoverHU({ value: val, unit: img.rescaleUnit });
      } else setHoverHU(null);
    }
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (d.mode === "wl") {
      setView((v) => ({
        ...v,
        width: Math.max(1, d.startWidth + dx * 2),
        center: d.startCenter - dy * 2,
      }));
    } else {
      const dpr = window.devicePixelRatio || 1;
      setView((v) => ({ ...v, panX: d.startPanX + dx * dpr, panY: d.startPanY + dy * dpr }));
    }
  };
  const endDrag = () => (drag.current = null);

  const importAsCase = async () => {
    if (images.length === 0) return;
    const blobs: Blob[] = [];
    const off = document.createElement("canvas");
    for (const im of images) {
      off.width = im.cols;
      off.height = im.rows;
      const octx = off.getContext("2d")!;
      const id = octx.createImageData(im.cols, im.rows);
      renderToImageData(im, view.center, view.width, view.invert, id);
      octx.putImageData(id, 0, 0);
      const blob = await new Promise<Blob | null>((r) => off.toBlob(r, "image/png"));
      if (blob) blobs.push(blob);
    }
    if (blobs.length === 0) return;
    const single = blobs.length === 1;
    const draft: RadCase = {
      id: `case-${Date.now()}`,
      title: images[0].seriesDescription || "Imported DICOM",
      explanation: "",
      modality: images[0].modality === "CT" ? "CT" : images[0].modality === "MR" ? "MRI" : "CT",
      bodyRegion: "Head",
      subspecialty: "Neuro",
      difficulty: "medium",
      regions: [],
      imageBlob: single ? blobs[0] : undefined,
      imageBlobs: single ? undefined : blobs,
      createdAt: Date.now(),
    };
    onImportSeries(draft);
  };

  const hasImages = images.length > 0;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">DICOM viewer</h1>
        <span className="hidden text-sm text-ink-faint sm:inline">Read .dcm studies like a PACS station</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button onClick={() => fileInput.current?.click()}>
            <FolderOpen size={15} />
            Open .dcm
          </Button>
          <Button onClick={loadSample} disabled={loading}>
            <Cube size={15} />
            Sample series
          </Button>
          {hasImages && (
            <Button variant="primary" onClick={importAsCase}>
              <FilePlus size={15} />
              Import as case
            </Button>
          )}
        </div>
      </div>
      <input
        ref={fileInput}
        type="file"
        accept=".dcm,application/dicom"
        multiple
        className="hidden"
        onChange={(e) => {
          loadFiles([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />

      {error && (
        <div className="flex items-start gap-2 rounded-(--radius-panel) border border-line bg-surface p-3 text-sm text-ink-dim">
          <Warning size={16} className="mt-0.5 shrink-0 text-near" />
          {error}
        </div>
      )}

      {!hasImages ? (
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            loadFiles([...e.dataTransfer.files]);
          }}
          className="flex min-h-80 cursor-pointer flex-col items-center justify-center gap-3 rounded-(--radius-panel) border-2 border-dashed border-line text-ink-dim transition-colors hover:border-accent hover:text-ink"
        >
          <Stack size={30} />
          <span className="max-w-sm text-center text-sm">
            Drop DICOM (.dcm) files here, or click to browse. Multiple files load as a scrollable
            series. Uncompressed DICOM only.
          </span>
          <span className="text-xs text-ink-faint">No sample on hand? Load the demo CT head series above.</span>
        </button>
      ) : (
        <div className="flex flex-col gap-3">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2">
            {WL_PRESETS.map((p) => (
              <button
                key={p.name}
                type="button"
                onClick={() => applyPreset(p.center, p.width)}
                className={`cursor-pointer rounded-(--radius-ctl) border px-2.5 py-1 text-xs transition-colors ${
                  Math.round(view.center) === p.center && Math.round(view.width) === p.width
                    ? "border-accent bg-accent-soft text-ink"
                    : "border-line text-ink-dim hover:border-line-strong hover:text-ink"
                }`}
              >
                {p.name}
              </button>
            ))}
            <div className="mx-1 h-5 w-px bg-(--border)" />
            <button
              type="button"
              onClick={() => setView((v) => ({ ...v, invert: !v.invert }))}
              className={`flex cursor-pointer items-center gap-1.5 rounded-(--radius-ctl) border px-2.5 py-1 text-xs transition-colors ${
                view.invert ? "border-accent bg-accent-soft text-ink" : "border-line text-ink-dim hover:border-line-strong"
              }`}
            >
              <CircleHalf size={14} />
              Invert
            </button>
            <button
              type="button"
              onClick={() => setView((v) => ({ ...v, zoom: Math.min(8, v.zoom * 1.2) }))}
              className="flex cursor-pointer items-center rounded-(--radius-ctl) border border-line px-2 py-1 text-ink-dim transition-colors hover:border-line-strong hover:text-ink"
              aria-label="Zoom in"
            >
              <MagnifyingGlassPlus size={14} />
            </button>
            <button
              type="button"
              onClick={() => setView((v) => ({ ...v, zoom: Math.max(0.5, v.zoom / 1.2) }))}
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

          {/* Canvas + slider */}
          <div className="flex items-stretch gap-2">
            <div
              ref={wrapRef}
              className="relative min-w-0 flex-1 overflow-hidden rounded-(--radius-panel) border border-line bg-black"
              style={{ height: "64vh" }}
            >
              <canvas
                ref={canvasRef}
                className="h-full w-full touch-none"
                style={{ cursor: "crosshair" }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerLeave={() => {
                  endDrag();
                  setHoverHU(null);
                }}
                onContextMenu={(e) => e.preventDefault()}
              />
              {/* Corner overlays */}
              <div className="pointer-events-none absolute left-3 top-2 font-mono text-[11px] leading-tight text-white/80">
                <div>{img.patientName || "Anonymous"}</div>
                <div className="text-white/60">{img.seriesDescription || img.modality}</div>
              </div>
              <div className="pointer-events-none absolute right-3 top-2 text-right font-mono text-[11px] leading-tight text-white/80">
                <div>
                  {slice + 1} / {images.length}
                </div>
                {img.sliceLocation != null && <div className="text-white/60">{img.sliceLocation.toFixed(1)} mm</div>}
              </div>
              <div className="pointer-events-none absolute bottom-2 left-3 font-mono text-[11px] leading-tight text-white/80">
                <div>
                  W {Math.round(view.width)} · L {Math.round(view.center)}
                </div>
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
                drag: window/level · shift-drag: pan · wheel: scroll · ⌘/ctrl-wheel: zoom
              </div>
            </div>

            {images.length > 1 && (
              <input
                type="range"
                min={0}
                max={images.length - 1}
                value={slice}
                onChange={(e) => setSlice(Number(e.target.value))}
                aria-label="Slice"
                className="slice-slider"
                style={{ height: "64vh" }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
