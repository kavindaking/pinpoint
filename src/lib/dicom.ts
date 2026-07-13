import dicomParser, { type DataSet } from "dicom-parser";

/**
 * A parsed DICOM image: modality pixel values (after rescale) plus the
 * metadata a viewer needs. Pixel values are stored as a typed array in
 * row-major order; for CT these are Hounsfield units.
 */
export interface DicomImage {
  rows: number;
  cols: number;
  pixels: Float32Array;
  min: number;
  max: number;
  windowCenter: number;
  windowWidth: number;
  invert: boolean; // MONOCHROME1 renders inverted by default
  modality: string;
  instanceNumber: number;
  sliceLocation: number | null;
  seriesUid: string;
  seriesDescription: string;
  patientName: string;
  rescaleUnit: string; // "HU" for CT, else ""
}

const UNCOMPRESSED = new Set([
  "1.2.840.10008.1.2", // Implicit VR Little Endian
  "1.2.840.10008.1.2.1", // Explicit VR Little Endian
  "1.2.840.10008.1.2.2", // Explicit VR Big Endian
]);

function firstNum(dataSet: DataSet, tag: string, fallback: number): number {
  try {
    const v = dataSet.floatString(tag, 0);
    return v === undefined || Number.isNaN(v) ? fallback : v;
  } catch {
    return fallback;
  }
}

export function parseDicom(buffer: ArrayBuffer): DicomImage {
  return parseDicomFrames(buffer)[0];
}

/**
 * Decode every frame in a DICOM object. Traditional CT/MR series commonly
 * store one slice per file, while ultrasound, cine, and some exported studies
 * store many frames in one file via Number of Frames (0028,0008).
 */
export function parseDicomFrames(buffer: ArrayBuffer): DicomImage[] {
  const byteArray = new Uint8Array(buffer);
  const dataSet = dicomParser.parseDicom(byteArray);

  const transferSyntax = dataSet.string("x00020010") ?? "1.2.840.10008.1.2";
  if (!UNCOMPRESSED.has(transferSyntax)) {
    throw new CompressedDicomError(transferSyntax);
  }
  const bigEndian = transferSyntax === "1.2.840.10008.1.2.2";

  const rows = dataSet.uint16("x00280010") ?? 0;
  const cols = dataSet.uint16("x00280011") ?? 0;
  const samplesPerPixel = dataSet.uint16("x00280002") ?? 1;
  const bitsAllocated = dataSet.uint16("x00280100") ?? 16;
  const pixelRepresentation = dataSet.uint16("x00280103") ?? 0; // 1 = signed
  const photometric = (dataSet.string("x00280004") ?? "MONOCHROME2").trim();
  const slope = firstNum(dataSet, "x00281053", 1);
  const intercept = firstNum(dataSet, "x00281052", 0);

  if (samplesPerPixel !== 1) {
    throw new Error("Colour DICOM images are not supported by this viewer.");
  }
  if (bitsAllocated !== 8 && bitsAllocated !== 16) {
    throw new Error(`DICOM pixels with ${bitsAllocated} bits are not supported.`);
  }
  const pixelEl = dataSet.elements.x7fe00010;
  if (!pixelEl) throw new Error("This file has no image pixel data.");

  const pixelsPerFrame = rows * cols;
  if (pixelsPerFrame <= 0) throw new Error("This DICOM has invalid image dimensions.");
  const offset = pixelEl.dataOffset;
  const dv = new DataView(buffer, offset, Math.min(pixelEl.length, buffer.byteLength - offset));
  const bytesPerPixel = bitsAllocated <= 8 ? 1 : 2;
  const bytesPerFrame = pixelsPerFrame * bytesPerPixel;
  const availableFrames = Math.floor(dv.byteLength / bytesPerFrame);
  const declaredFrames = Math.max(1, dataSet.intString("x00280008") ?? 1);
  const frameCount = Math.min(declaredFrames, availableFrames);
  if (frameCount === 0) throw new Error("This DICOM has incomplete pixel data.");

  const modality = (dataSet.string("x00080060") ?? "").trim();
  const baseInstance = dataSet.intString("x00200013") ?? 0;
  const baseSliceLocation = safeFloat(dataSet, "x00201041");
  const frames: DicomImage[] = [];

  for (let frame = 0; frame < frameCount; frame++) {
    const pixels = new Float32Array(pixelsPerFrame);
    const frameOffset = frame * bytesPerFrame;
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < pixelsPerFrame; i++) {
      const byteOffset = frameOffset + i * bytesPerPixel;
      let raw: number;
      if (bitsAllocated <= 8) {
        raw = pixelRepresentation ? dv.getInt8(byteOffset) : dv.getUint8(byteOffset);
      } else {
        raw = pixelRepresentation
          ? dv.getInt16(byteOffset, !bigEndian)
          : dv.getUint16(byteOffset, !bigEndian);
      }
      const value = raw * slope + intercept;
      pixels[i] = value;
      if (value < min) min = value;
      if (value > max) max = value;
    }

    frames.push({
      rows,
      cols,
      pixels,
      min,
      max,
      windowCenter: firstNum(dataSet, "x00281050", (min + max) / 2),
      windowWidth: firstNum(dataSet, "x00281051", Math.max(1, max - min)),
      invert: photometric === "MONOCHROME1",
      modality,
      // A fractional suffix preserves frame order without colliding with the
      // next single-frame file's instance number when sources are combined.
      instanceNumber: baseInstance + frame / Math.max(frameCount, 1),
      sliceLocation: baseSliceLocation,
      seriesUid: dataSet.string("x0020000e") ?? "series",
      seriesDescription: (dataSet.string("x0008103e") ?? "").trim(),
      patientName: (dataSet.string("x00100010") ?? "").replace(/\^/g, " ").trim(),
      rescaleUnit: modality === "CT" ? "HU" : "",
    });
  }

  return frames;
}

function safeFloat(dataSet: DataSet, tag: string): number | null {
  try {
    const v = dataSet.floatString(tag, 0);
    return v === undefined || Number.isNaN(v) ? null : v;
  } catch {
    return null;
  }
}

export class CompressedDicomError extends Error {
  constructor(public transferSyntax: string) {
    super(`Compressed DICOM (transfer syntax ${transferSyntax}) is not supported.`);
    this.name = "CompressedDicomError";
  }
}

/**
 * Window the modality pixels into an RGBA buffer for a canvas. Values at or
 * below (center - width/2) map to black, at or above (center + width/2) to
 * white, linearly in between. Invert flips the ramp (for MONOCHROME1 or a
 * user toggle).
 */
export function renderToImageData(
  img: DicomImage,
  center: number,
  width: number,
  invert: boolean,
  out: ImageData,
): void {
  const { pixels, rows, cols } = img;
  const low = center - width / 2;
  const scale = width <= 0 ? 0 : 255 / width;
  const data = out.data;
  const n = rows * cols;
  for (let i = 0; i < n; i++) {
    let v = (pixels[i] - low) * scale;
    if (v < 0) v = 0;
    else if (v > 255) v = 255;
    if (invert) v = 255 - v;
    const j = i * 4;
    data[j] = data[j + 1] = data[j + 2] = v;
    data[j + 3] = 255;
  }
}

/** Window/level presets, in modality units (HU for CT). */
export const WL_PRESETS: { name: string; center: number; width: number }[] = [
  { name: "Brain", center: 40, width: 80 },
  { name: "Soft tissue", center: 50, width: 400 },
  { name: "Lung", center: -600, width: 1500 },
  { name: "Bone", center: 300, width: 1500 },
  { name: "Abdomen", center: 40, width: 350 },
];
