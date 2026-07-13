import { useCallback, useEffect, useRef, useState } from "react";
import { Cube, FilePlus, FolderOpen, Stack, Warning } from "../components/icons";
import { DicomStudyViewer } from "../components/DicomStudyViewer";
import { Button } from "../components/ui";
import {
  CompressedDicomError,
  parseDicomFrames,
  renderToImageData,
  type DicomImage,
} from "../lib/dicom";
import type { RadCase } from "../types";

/** Load/import shell for the original Sample Viewer surface. */
export function Viewer({ onImportSeries }: { onImportSeries: (draft: RadCase) => void }) {
  const [images, setImages] = useState<DicomImage[]>([]);
  const [dicomBlobs, setDicomBlobs] = useState<Blob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const directoryInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    directoryInput.current?.setAttribute("webkitdirectory", "");
  }, []);

  const loadFiles = useCallback(async (files: File[], fromFolder = false) => {
    const dcm = files.filter(
      (file) =>
        file.name.toLowerCase().endsWith(".dcm") || file.type === "application/dicom",
    );
    // Study folders often contain DICOMDIR or extensionless image files, so
    // try every non-hidden file and keep only the decodable image objects.
    const chosen = fromFolder ? files.filter((file) => !file.name.startsWith(".")) : dcm.length ? dcm : files;
    if (chosen.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const parsed: { images: DicomImage[]; blob: Blob }[] = [];
      let compressed = false;
      for (const file of chosen) {
        try {
          parsed.push({ images: parseDicomFrames(await file.arrayBuffer()), blob: file });
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
      parsed.sort((a, b) => a.images[0].instanceNumber - b.images[0].instanceNumber);
      const decodedImages = parsed.flatMap((entry) => entry.images);
      setImages(decodedImages);
      setDicomBlobs(parsed.map((entry) => entry.blob));
      if (compressed) {
        setError(`${decodedImages.length} slices loaded. Some files were skipped because they were compressed.`);
      } else if (decodedImages.length === 1) {
        setError(
          "Only 1 slice loaded. Choose the complete DICOM folder (or select all of its .dcm files) to load a scrollable study.",
        );
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
      dicomFrameCount: images.length,
      posterBlob,
      createdAt: Date.now(),
    });
  };

  const hasImages = images.length > 0;

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
            Choose files
          </Button>
          <Button onClick={() => directoryInput.current?.click()}>
            <FolderOpen size={15} />
            DICOM folder
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
        onChange={(event) => {
          loadFiles([...(event.target.files ?? [])]);
          event.target.value = "";
        }}
      />
      <input
        ref={directoryInput}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          void loadFiles([...(event.currentTarget.files ?? [])], true);
          event.currentTarget.value = "";
        }}
      />

      {error && (
        <div className="flex items-start gap-2 rounded-(--radius-panel) border border-line bg-surface p-3 text-sm text-ink-dim">
          <Warning size={16} className="mt-0.5 shrink-0 text-near" />
          {error}
        </div>
      )}

      {!hasImages ? (
        <div
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            loadFiles([...event.dataTransfer.files]);
          }}
          className="flex min-h-80 cursor-pointer flex-col items-center justify-center gap-3 rounded-(--radius-panel) border-2 border-dashed border-line text-ink-dim transition-colors hover:border-accent hover:text-ink"
        >
          <Stack size={30} />
          <span className="max-w-sm text-center text-sm">
            A CT or MRI study normally contains one .dcm file per slice. Choose the complete
            DICOM folder to load the scrollable series.
          </span>
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="primary" onClick={() => directoryInput.current?.click()}>
              Choose DICOM folder
            </Button>
            <Button onClick={() => fileInput.current?.click()}>Choose files</Button>
          </div>
          <span className="text-xs text-ink-faint">Uncompressed DICOM only.</span>
        </div>
      ) : (
        <DicomStudyViewer images={images} />
      )}
    </div>
  );
}
