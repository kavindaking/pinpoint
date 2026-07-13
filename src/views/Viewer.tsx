import { useCallback, useMemo, useRef, useState } from "react";
import { Cube, FilePlus, FolderOpen, Stack, Warning } from "../components/icons";
import { ImageViewer } from "../components/ImageViewer";
import { Button } from "../components/ui";
import { CompressedDicomError, parseDicom, renderToImageData, type DicomImage } from "../lib/dicom";
import type { RadCase } from "../types";

/**
 * DICOM study loader. The actual viewport is the shared ImageViewer used by
 * Play and Study, so the Viewer tab and quiz cannot drift into separate
 * rendering or interaction implementations.
 */
export function Viewer({ onImportSeries }: { onImportSeries: (draft: RadCase) => void }) {
  const [images, setImages] = useState<DicomImage[]>([]);
  const [dicomBlobs, setDicomBlobs] = useState<Blob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const viewerCase = useMemo<RadCase | null>(() => {
    const first = images[0];
    if (!first || dicomBlobs.length === 0) return null;
    return {
      id: "viewer-study",
      title: first.seriesDescription || "DICOM study",
      explanation: "",
      modality: first.modality === "MR" ? "MRI" : "CT",
      bodyRegion: "Head",
      subspecialty: "Neuro",
      difficulty: "medium",
      regions: [],
      dicomBlobs,
      createdAt: 0,
    };
  }, [images, dicomBlobs]);

  const loadFiles = useCallback(async (files: File[]) => {
    const dcm = files.filter(
      (file) =>
        file.name.toLowerCase().endsWith(".dcm") || file.type === "application/dicom",
    );
    const chosen = dcm.length ? dcm : files;
    if (chosen.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const parsed: { image: DicomImage; blob: Blob }[] = [];
      let compressed = false;
      for (const file of chosen) {
        try {
          parsed.push({ image: parseDicom(await file.arrayBuffer()), blob: file });
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
      parsed.sort((a, b) => a.image.instanceNumber - b.image.instanceNumber);
      setImages(parsed.map((entry) => entry.image));
      setDicomBlobs(parsed.map((entry) => entry.blob));
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
        const response = await fetch(`/samples/dicom/${name}`);
        if (!response.ok) continue;
        files.push(new File([await response.blob()], name, { type: "application/dicom" }));
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

  const importAsCase = async () => {
    const first = images[0];
    if (!first || dicomBlobs.length === 0) return;
    const posterImage = images[Math.floor(images.length / 2)];
    const canvas = document.createElement("canvas");
    canvas.width = posterImage.cols;
    canvas.height = posterImage.rows;
    const context = canvas.getContext("2d")!;
    const imageData = context.createImageData(posterImage.cols, posterImage.rows);
    renderToImageData(
      posterImage,
      posterImage.windowCenter,
      posterImage.windowWidth,
      posterImage.invert,
      imageData,
    );
    context.putImageData(imageData, 0, 0);
    const posterBlob =
      (await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"))) ??
      undefined;

    onImportSeries({
      id: `case-${Date.now()}`,
      title: first.seriesDescription || "Imported DICOM",
      explanation: "",
      modality: first.modality === "MR" ? "MRI" : "CT",
      bodyRegion: "Head",
      subspecialty: "Neuro",
      difficulty: "medium",
      regions: [],
      dicomBlobs,
      posterBlob,
      createdAt: Date.now(),
    });
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">DICOM viewer</h1>
        <span className="hidden text-sm text-ink-faint sm:inline">
          Read .dcm studies like a PACS station
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button onClick={() => fileInput.current?.click()}>
            <FolderOpen size={15} />
            Open .dcm
          </Button>
          <Button onClick={loadSample} disabled={loading}>
            <Cube size={15} />
            Sample series
          </Button>
          {viewerCase && (
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
        onChange={(event) => {
          loadFiles([...(event.target.files ?? [])]);
          event.target.value = "";
        }}
      />

      {error && (
        <div className="flex items-start gap-2 rounded-(--radius-panel) border border-line bg-surface p-3 text-sm text-ink-dim">
          <Warning size={16} className="mt-0.5 shrink-0 text-near" />
          {error}
        </div>
      )}

      {!viewerCase ? (
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            loadFiles([...event.dataTransfer.files]);
          }}
          className="flex min-h-80 cursor-pointer flex-col items-center justify-center gap-3 rounded-(--radius-panel) border-2 border-dashed border-line text-ink-dim transition-colors hover:border-accent hover:text-ink"
        >
          <Stack size={30} />
          <span className="max-w-sm text-center text-sm">
            Drop DICOM (.dcm) files here, or click to browse. Multiple files load as a
            scrollable series. Uncompressed DICOM only.
          </span>
          <span className="text-xs text-ink-faint">
            No sample on hand? Load the demo CT head series above.
          </span>
        </button>
      ) : (
        <>
          <ImageViewer
            radCase={viewerCase}
            pacs
            workstation
            cursor="crosshair"
            maxHeight="64vh"
          />
          <p className="text-center font-mono text-[10.5px] text-ink-faint">
            drag: window/level · shift-drag: pan · wheel: scroll · ⌘/ctrl-wheel: zoom
          </p>
        </>
      )}
    </div>
  );
}
