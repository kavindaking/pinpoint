import { useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Circle,
  Crosshair,
  FloppyDisk,
  Polygon as PolygonIcon,
  Square,
  Trash,
  UploadSimple,
} from "../components/icons";
import type { BodyRegion, CaseRegion, Difficulty, Modality, RadCase, Shape, Subspecialty } from "../types";
import {
  BODY_REGIONS,
  DIFFICULTIES,
  MODALITIES,
  SUBSPECIALTIES,
  frameCount,
  inferSubspecialty,
  isDicom,
} from "../types";
import { ImageViewer, type ViewerPoint } from "../components/ImageViewer";
import { ShapeSvg } from "../components/ShapeSvg";
import { Button, Field, Panel, Select, inputClass } from "../components/ui";
import {
  CompressedDicomError,
  parseDicomFrames,
  renderToImageData,
  type DicomImage,
} from "../lib/dicom";

type Tool = "point" | "ellipse" | "rect" | "polygon";

const TOOLS: { id: Tool; label: string; icon: typeof Circle }[] = [
  { id: "ellipse", label: "Ellipse", icon: Circle },
  { id: "rect", label: "Box", icon: Square },
  { id: "polygon", label: "Freehand", icon: PolygonIcon },
  { id: "point", label: "Point", icon: Crosshair },
];

let regionCounter = 0;
const newRegionId = () => `region-${Date.now()}-${regionCounter++}`;

async function makeDicomPoster(image: DicomImage): Promise<Blob | undefined> {
  const canvas = document.createElement("canvas");
  canvas.width = image.cols;
  canvas.height = image.rows;
  const context = canvas.getContext("2d");
  if (!context) return undefined;
  const imageData = context.createImageData(image.cols, image.rows);
  renderToImageData(
    image,
    image.windowCenter,
    image.windowWidth,
    image.invert,
    imageData,
  );
  context.putImageData(imageData, 0, 0);
  return (
    (await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"))) ??
    undefined
  );
}

export function Editor({
  existing,
  onSave,
  onCancel,
}: {
  existing: RadCase | null;
  onSave: (c: RadCase) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(existing?.title ?? "");
  const [stem, setStem] = useState(existing?.stem ?? "");
  const [explanation, setExplanation] = useState(existing?.explanation ?? "");
  const [modality, setModality] = useState<Modality>(existing?.modality ?? "X-ray");
  const [bodyRegion, setBodyRegion] = useState<BodyRegion>(existing?.bodyRegion ?? "Chest");
  const [subspecialty, setSubspecialty] = useState<Subspecialty>(existing?.subspecialty ?? "Chest");
  const [difficulty, setDifficulty] = useState<Difficulty>(existing?.difficulty ?? "medium");
  const [credit, setCredit] = useState(existing?.credit ?? "");
  // Newly uploaded frames; empty keeps whatever the existing case already has.
  const [blobs, setBlobs] = useState<Blob[]>(
    existing?.imageBlobs ?? (existing?.imageBlob ? [existing.imageBlob] : []),
  );
  const [dicomBlobs, setDicomBlobs] = useState<Blob[]>(existing?.dicomBlobs ?? []);
  const [dicomFrameCount, setDicomFrameCount] = useState(
    existing?.dicomFrameCount ?? existing?.dicomBlobs?.length ?? 0,
  );
  const [dicomPoster, setDicomPoster] = useState<Blob | undefined>(existing?.posterBlob);
  const [regions, setRegions] = useState<CaseRegion[]>(existing?.regions ?? []);
  const [slice, setSlice] = useState(0);

  const [tool, setTool] = useState<Tool>("ellipse");
  const [draft, setDraft] = useState<Shape | null>(null);
  const [polyPoints, setPolyPoints] = useState<[number, number][]>([]);
  const [jump, setJump] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dragAnchor = useRef<ViewerPoint | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // A stand-in case object so the viewer can render before saving. Only
  // image-related fields matter here; keeping the deps narrow avoids
  // re-mounting the viewer on every metadata keystroke.
  const previewCase: RadCase | null = useMemo(() => {
    const hasImages = blobs.length > 0;
    const hasDicom = dicomBlobs.length > 0;
    const replacingExisting = hasImages || hasDicom;
    const hasExisting =
      existing?.imageUrl ||
      existing?.imageUrls?.length ||
      existing?.dicomUrls?.length ||
      existing?.dicomBlobs?.length;
    if (!replacingExisting && !hasExisting) return null;
    return {
      id: existing?.id ?? "draft",
      title: "Draft",
      explanation: "",
      modality: "X-ray",
      bodyRegion: "Chest",
      subspecialty: "Chest",
      difficulty: "medium",
      regions: [],
      imageUrl: replacingExisting ? undefined : existing?.imageUrl,
      imageUrls: replacingExisting ? undefined : existing?.imageUrls,
      imageBlob: hasImages && blobs.length === 1 ? blobs[0] : undefined,
      imageBlobs: hasImages && blobs.length > 1 ? blobs : undefined,
      dicomUrls: replacingExisting ? undefined : existing?.dicomUrls,
      dicomBlobs: hasDicom ? dicomBlobs : replacingExisting ? undefined : existing?.dicomBlobs,
      dicomFrameCount: hasDicom
        ? dicomFrameCount
        : replacingExisting
          ? undefined
          : existing?.dicomFrameCount,
      createdAt: 0,
    };
  }, [blobs, dicomBlobs, dicomFrameCount, existing]);

  const frames = previewCase ? frameCount(previewCase) : 1;
  const isStack = frames > 1;

  const commitRegion = (shape: Shape) => {
    setRegions((rs) => [
      ...rs,
      { id: newRegionId(), label: `Finding ${rs.length + 1}`, shape, slice },
    ]);
  };

  const handleTap = (p: ViewerPoint) => {
    if (tool === "point") {
      commitRegion({ kind: "point", x: p.x, y: p.y });
    } else if (tool === "polygon") {
      // Tapping near the first vertex closes the polygon.
      if (polyPoints.length >= 3) {
        const [fx, fy] = polyPoints[0];
        if (Math.hypot(p.x - fx, p.y - fy) < 0.02) {
          commitRegion({ kind: "polygon", points: polyPoints });
          setPolyPoints([]);
          return;
        }
      }
      setPolyPoints((pts) => [...pts, [p.x, p.y]]);
    }
  };

  const drag = {
    down: (p: ViewerPoint) => {
      if (tool !== "ellipse" && tool !== "rect") return;
      dragAnchor.current = p;
    },
    move: (p: ViewerPoint) => {
      const a = dragAnchor.current;
      if (!a) return;
      if (tool === "ellipse") {
        setDraft({
          kind: "ellipse",
          cx: (a.x + p.x) / 2,
          cy: (a.y + p.y) / 2,
          rx: Math.abs(p.x - a.x) / 2,
          ry: Math.abs(p.y - a.y) / 2,
        });
      } else if (tool === "rect") {
        setDraft({
          kind: "rect",
          x: Math.min(a.x, p.x),
          y: Math.min(a.y, p.y),
          w: Math.abs(p.x - a.x),
          h: Math.abs(p.y - a.y),
        });
      }
    },
    up: () => {
      dragAnchor.current = null;
      if (draft) {
        const bigEnough =
          (draft.kind === "ellipse" && draft.rx > 0.005 && draft.ry > 0.005) ||
          (draft.kind === "rect" && draft.w > 0.01 && draft.h > 0.01);
        if (bigEnough) commitRegion(draft);
        setDraft(null);
      }
    },
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const selected = [...files];
    const dicomFiles = selected.filter(
      (file) =>
        file.name.toLowerCase().endsWith(".dcm") || file.type === "application/dicom",
    );
    if (dicomFiles.length > 0) {
      if (dicomFiles.length !== selected.length) {
        setError("Choose either DICOM files or image files, not both at once.");
        return;
      }
      const parsed: { images: DicomImage[]; blob: Blob }[] = [];
      let compressed = false;
      for (const file of dicomFiles) {
        try {
          parsed.push({ images: parseDicomFrames(await file.arrayBuffer()), blob: file });
        } catch (err) {
          if (err instanceof CompressedDicomError) compressed = true;
        }
      }
      if (parsed.length === 0) {
        setError(
          compressed
            ? "These DICOM files are compressed. Please use uncompressed .dcm files."
            : "No readable DICOM images were found.",
        );
        return;
      }
      parsed.sort((a, b) => a.images[0].instanceNumber - b.images[0].instanceNumber);
      const decodedImages = parsed.flatMap((entry) => entry.images);
      setBlobs([]);
      setDicomBlobs(parsed.map((entry) => entry.blob));
      setDicomFrameCount(decodedImages.length);
      setDicomPoster(await makeDicomPoster(decodedImages[Math.floor(decodedImages.length / 2)]));
      const first = decodedImages[0];
      if (first.modality === "CT") setModality("CT");
      else if (first.modality === "MR") setModality("MRI");
      setError(
        compressed
          ? `${decodedImages.length} slices loaded. Some compressed files were skipped.`
          : null,
      );
      setRegions([]);
      setPolyPoints([]);
      setSlice(0);
      return;
    }

    const images = selected.filter((file) => file.type.startsWith("image/"));
    if (images.length === 0) {
      setError("Please choose DICOM, PNG, JPG, or WebP files.");
      return;
    }
    // Natural sort by filename so slice-01, slice-02, ... land in order.
    images.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    setError(null);
    setBlobs(images);
    setDicomBlobs([]);
    setDicomFrameCount(0);
    setDicomPoster(undefined);
    setRegions([]);
    setPolyPoints([]);
    setSlice(0);
  };

  const save = () => {
    if (!previewCase) return setError("Upload an image first.");
    if (!title.trim()) return setError("Give the case a finding or diagnosis name.");
    if (regions.length === 0) return setError("Mark at least one abnormality region on the image.");
    setError(null);
    const hasImages = blobs.length > 0;
    const hasDicom = dicomBlobs.length > 0;
    const replacingExisting = hasImages || hasDicom;
    onSave({
      id: existing?.id ?? `case-${Date.now()}`,
      title: title.trim(),
      stem: stem.trim() || undefined,
      explanation: explanation.trim(),
      modality,
      bodyRegion,
      subspecialty,
      difficulty,
      regions,
      imageUrl: replacingExisting ? undefined : existing?.imageUrl,
      imageUrls: replacingExisting ? undefined : existing?.imageUrls,
      imageBlob: hasImages && blobs.length === 1 ? blobs[0] : undefined,
      imageBlobs: hasImages && blobs.length > 1 ? blobs : undefined,
      dicomUrls: replacingExisting ? undefined : existing?.dicomUrls,
      dicomBlobs: hasDicom ? dicomBlobs : replacingExisting ? undefined : existing?.dicomBlobs,
      dicomFrameCount: hasDicom
        ? dicomFrameCount
        : replacingExisting
          ? undefined
          : existing?.dicomFrameCount,
      posterUrl: replacingExisting ? undefined : existing?.posterUrl,
      posterBlob: hasDicom ? dicomPoster : replacingExisting ? undefined : existing?.posterBlob,
      credit: credit.trim() || undefined,
      seed: existing?.seed,
      createdAt: existing?.createdAt ?? Date.now(),
    });
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <div className="mb-5 flex items-center gap-3">
        <Button variant="ghost" onClick={onCancel} className="!px-3" aria-label="Back to cases">
          <ArrowLeft size={16} weight="bold" />
        </Button>
        <h1 className="text-xl font-semibold tracking-tight">
          {existing ? "Edit case" : "New case"}
        </h1>
        <div className="ml-auto flex items-center gap-3">
          {error && <p className="text-sm text-miss">{error}</p>}
          <Button variant="primary" onClick={save}>
            <FloppyDisk size={16} />
            Save case
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        {/* Canvas side */}
        <div className="flex min-w-0 flex-col gap-3">
          {previewCase ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                {TOOLS.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      setTool(id);
                      setPolyPoints([]);
                    }}
                    className={`flex cursor-pointer items-center gap-1.5 rounded-(--radius-ctl) border px-3 py-1.5 text-sm transition-colors ${
                      tool === id
                        ? "border-accent bg-accent-soft text-ink"
                        : "border-line text-ink-dim hover:border-line-strong"
                    }`}
                  >
                    <Icon size={15} weight={tool === id ? "fill" : "regular"} />
                    {label}
                  </button>
                ))}
                <Button
                  variant="ghost"
                  className="!px-3 !py-1.5 ml-auto"
                  onClick={() => fileInput.current?.click()}
                >
                  <UploadSimple size={15} />
                  {isStack ? "Replace stack" : "Replace image"}
                </Button>
              </div>

              <ImageViewer
                radCase={previewCase}
                pacs={isDicom(previewCase)}
                onTap={handleTap}
                onDrag={drag}
                onSlice={setSlice}
                jumpTo={jump}
                cursor="crosshair"
                maxHeight="62vh"
                overlay={(w, h, viewSlice) => (
                  <>
                    {regions
                      .filter((r) => (r.slice ?? 0) === viewSlice)
                      .map((r) => (
                        <ShapeSvg
                          key={r.id}
                          shape={r.shape}
                          w={w}
                          h={h}
                          stroke="var(--accent)"
                          fill="var(--accent)"
                          fillOpacity={0.12}
                        />
                      ))}
                    {draft && (
                      <ShapeSvg shape={draft} w={w} h={h} stroke="var(--accent-strong)" dashed />
                    )}
                    {polyPoints.length > 0 && (
                      <g>
                        <polyline
                          points={polyPoints.map(([x, y]) => `${x * w},${y * h}`).join(" ")}
                          fill="none"
                          stroke="var(--accent-strong)"
                          strokeWidth={2}
                          strokeDasharray="6 5"
                          vectorEffect="non-scaling-stroke"
                        />
                        {polyPoints.map(([x, y], i) => (
                          <circle
                            key={i}
                            cx={x * w}
                            cy={y * h}
                            r={i === 0 ? 6 : 3.5}
                            fill={i === 0 ? "var(--accent)" : "var(--accent-strong)"}
                          />
                        ))}
                      </g>
                    )}
                  </>
                )}
              />
              <p className="text-xs text-ink-faint">
                {isStack && <span className="text-accent">On slice {slice + 1}. </span>}
                {tool === "polygon"
                  ? polyPoints.length === 0
                    ? "Click to place the first vertex of the region outline."
                    : "Keep clicking to outline the region; click the first (large) dot to close it."
                  : tool === "point"
                    ? "Click the exact spot of the finding. Its hit radius comes from the scoring settings."
                    : "Click and drag to draw around the abnormality."}
                {isStack && " Scroll to mark findings on other slices."}
              </p>
              {tool === "polygon" && polyPoints.length >= 3 && (
                <div className="flex gap-2">
                  <Button
                    variant="primary"
                    className="!py-1.5"
                    onClick={() => {
                      commitRegion({ kind: "polygon", points: polyPoints });
                      setPolyPoints([]);
                    }}
                  >
                    Close region
                  </Button>
                  <Button className="!py-1.5" onClick={() => setPolyPoints([])}>
                    Discard outline
                  </Button>
                </div>
              )}
            </>
          ) : (
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="flex min-h-72 cursor-pointer flex-col items-center justify-center gap-3 rounded-(--radius-panel) border-2 border-dashed border-line text-ink-dim transition-colors hover:border-accent hover:text-ink"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                handleFiles(e.dataTransfer.files);
              }}
            >
              <UploadSimple size={28} />
              <span className="max-w-xs text-center text-sm">
                Drop de-identified DICOM, PNG, JPG, or WebP files here. Select multiple DICOM
                files or images for a scrollable CT or MRI stack.
              </span>
            </button>
          )}
          <input
            ref={fileInput}
            type="file"
            accept=".dcm,application/dicom,image/png,image/jpeg,image/webp"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>

        {/* Metadata side */}
        <div className="flex flex-col gap-4">
          <Panel className="flex flex-col gap-4 p-4">
            <Field label="Finding / diagnosis">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Pneumothorax"
                className={inputClass}
              />
            </Field>
            <Field label="Clinical stem (optional)">
              <input
                value={stem}
                onChange={(e) => setStem(e.target.value)}
                placeholder="Short history shown before answering"
                className={inputClass}
              />
            </Field>
            <Field label="Teaching point">
              <textarea
                value={explanation}
                onChange={(e) => setExplanation(e.target.value)}
                placeholder="One or two lines shown after answering"
                rows={3}
                className={inputClass + " resize-y"}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Modality">
                <Select value={modality} onChange={(e) => setModality(e.target.value as Modality)}>
                  {MODALITIES.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Body region">
                <Select
                  value={bodyRegion}
                  onChange={(e) => {
                    const next = e.target.value as BodyRegion;
                    // Follow the body region's default subspecialty until the
                    // user picks one deliberately.
                    if (subspecialty === inferSubspecialty(bodyRegion)) {
                      setSubspecialty(inferSubspecialty(next));
                    }
                    setBodyRegion(next);
                  }}
                >
                  {BODY_REGIONS.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Subspecialty">
                <Select value={subspecialty} onChange={(e) => setSubspecialty(e.target.value as Subspecialty)}>
                  {SUBSPECIALTIES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Difficulty">
                <Select value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)}>
                  {DIFFICULTIES.map((d) => (
                    <option key={d}>{d}</option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Image credit (optional)">
              <input
                value={credit}
                onChange={(e) => setCredit(e.target.value)}
                placeholder="Source, license"
                className={inputClass}
              />
            </Field>
          </Panel>

          <Panel className="p-4">
            <p className="mb-3 text-sm text-ink-dim">
              Regions <span className="font-mono text-ink-faint">({regions.length})</span>
            </p>
            {regions.length === 0 ? (
              <p className="text-sm text-ink-faint">
                Nothing marked yet. Draw on the image with the tools above; multiple findings per
                case are fine.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {regions.map((r, i) => (
                  <li key={r.id} className="flex items-center gap-2">
                    <span className="font-mono text-xs text-ink-faint">{i + 1}</span>
                    <input
                      value={r.label ?? ""}
                      onChange={(e) =>
                        setRegions((rs) =>
                          rs.map((x) => (x.id === r.id ? { ...x, label: e.target.value } : x)),
                        )
                      }
                      className={inputClass + " flex-1 !py-1.5"}
                      aria-label={`Label for region ${i + 1}`}
                    />
                    {isStack ? (
                      <button
                        type="button"
                        onClick={() => setJump(r.slice ?? 0)}
                        className="cursor-pointer font-mono text-xs text-ink-faint transition-colors hover:text-accent"
                        title="Jump to this slice"
                      >
                        sl {(r.slice ?? 0) + 1}
                      </button>
                    ) : (
                      <span className="text-xs text-ink-faint">{r.shape.kind}</span>
                    )}
                    <button
                      type="button"
                      onClick={() => setRegions((rs) => rs.filter((x) => x.id !== r.id))}
                      className="cursor-pointer p-1 text-ink-faint transition-colors hover:text-miss"
                      aria-label={`Delete region ${i + 1}`}
                    >
                      <Trash size={15} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
