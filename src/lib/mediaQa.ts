import type { MediaQaReport, Modality } from "../types";
import { parseDicomFrames } from "./dicom";

const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_CASE_BYTES = 512 * 1024 * 1024;

async function hexDigest(data: ArrayBuffer | Uint8Array): Promise<string> {
  const source = data instanceof Uint8Array ? data : new Uint8Array(data);
  const bytes = new Uint8Array(source.byteLength);
  bytes.set(source);
  const digest = await crypto.subtle.digest("SHA-256", bytes.buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function imageDimensions(blob: Blob): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(blob);
  const result = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return result;
}

export async function analyseCaseMedia(
  files: Blob[],
  modality: Modality,
  dicom: boolean,
): Promise<MediaQaReport> {
  const warnings: string[] = [];
  const errors: string[] = [];
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (files.length === 0) errors.push("No media files were selected.");
  if (files.some((file) => file.size > MAX_FILE_BYTES)) errors.push("A file exceeds the 64 MB limit.");
  if (totalBytes > MAX_CASE_BYTES) errors.push("The complete case exceeds the 512 MB limit.");

  const dimensions: { width: number; height: number }[] = [];
  const hashes: string[] = [];
  for (const file of files) {
    const buffer = await file.arrayBuffer();
    hashes.push(await hexDigest(buffer));
    try {
      if (dicom) {
        const frames = parseDicomFrames(buffer);
        dimensions.push(...frames.map((frame) => ({ width: frame.cols, height: frame.rows })));
      } else {
        dimensions.push(await imageDimensions(file));
      }
    } catch {
      errors.push(`A selected ${dicom ? "DICOM" : "image"} file could not be decoded.`);
    }
  }
  const minWidth = dimensions.length ? Math.min(...dimensions.map((item) => item.width)) : undefined;
  const minHeight = dimensions.length ? Math.min(...dimensions.map((item) => item.height)) : undefined;
  const minimum = Math.min(minWidth ?? Infinity, minHeight ?? Infinity);
  if (minimum < 512) warnings.push("One or more frames are below 512 pixels on the shortest side.");
  else if (modality === "X-ray" && minimum < 1000) warnings.push("Radiographs below 1000 pixels may look soft on large displays.");
  if (!dicom && files.length > 1) warnings.push("Multiple flat images will be treated as an ordered stack; confirm their filenames sort correctly.");
  const fingerprint = await hexDigest(new TextEncoder().encode(hashes.join(":")));
  return {
    status: errors.length ? "fail" : warnings.length ? "warning" : "pass",
    checkedAt: new Date().toISOString(),
    fileCount: files.length,
    totalBytes,
    minWidth,
    minHeight,
    fingerprint,
    warnings,
    errors,
  };
}
