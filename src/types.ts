export const MODALITIES = ["X-ray", "CT", "MRI", "Ultrasound"] as const;
export type Modality = (typeof MODALITIES)[number];

export const BODY_REGIONS = [
  "Chest",
  "Abdomen",
  "Head",
  "Spine",
  "Upper limb",
  "Lower limb",
  "Pelvis",
] as const;
export type BodyRegion = (typeof BODY_REGIONS)[number];

export const DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

/** Radiology subspecialty, the primary way cases are grouped and filtered. */
export const SUBSPECIALTIES = [
  "Chest",
  "MSK",
  "Neuro",
  "Abdominal",
  "Cardiac",
  "Head & Neck",
  "Pediatric",
  "Breast",
] as const;
export type Subspecialty = (typeof SUBSPECIALTIES)[number];

/** Best-guess subspecialty for older cases saved before the field existed. */
export function inferSubspecialty(bodyRegion: BodyRegion): Subspecialty {
  switch (bodyRegion) {
    case "Chest":
      return "Chest";
    case "Head":
    case "Spine":
      return "Neuro";
    case "Abdomen":
      return "Abdominal";
    default:
      return "MSK";
  }
}

/**
 * All region coordinates are normalized to the image (0..1 in both axes),
 * so ground truth is independent of display size. Scoring converts them to
 * natural-pixel space to get geometrically honest distances.
 */
export type Shape =
  | { kind: "point"; x: number; y: number }
  | { kind: "ellipse"; cx: number; cy: number; rx: number; ry: number }
  | { kind: "rect"; x: number; y: number; w: number; h: number }
  | { kind: "polygon"; points: [number, number][] };

export interface CaseRegion {
  id: string;
  label?: string;
  shape: Shape;
  /** Slice this finding lives on in a multi-slice stack; 0 for single images. */
  slice?: number;
}

export interface RadCase {
  id: string;
  title: string;
  stem?: string;
  explanation: string;
  modality: Modality;
  bodyRegion: BodyRegion;
  subspecialty: Subspecialty;
  difficulty: Difficulty;
  regions: CaseRegion[];
  /** Static asset path for a single-image bundled seed case. */
  imageUrl?: string;
  /** Uploaded single image for a user-created case; lives in IndexedDB. */
  imageBlob?: Blob;
  /** Ordered asset paths for a bundled multi-slice stack (CT/MRI). */
  imageUrls?: string[];
  /** Ordered uploaded slices for a user-created stack; live in IndexedDB. */
  imageBlobs?: Blob[];
  /**
   * Ordered .dcm asset paths for a bundled DICOM series. Rendered through the
   * DICOM pipeline (true window/level, square pixel spacing) instead of as
   * flat images, so it reads like a workstation and keeps real proportions.
   */
  dicomUrls?: string[];
  /** Poster image (a rendered slice) so the case card can show a thumbnail. */
  posterUrl?: string;
  credit?: string;
  /** Curated bundled case. Absent/false means a user's personal case. */
  seed?: boolean;
  createdAt: number;
}

/** Number of slices in a case; 1 for single-image cases. */
export function frameCount(c: RadCase): number {
  if (c.dicomUrls?.length) return c.dicomUrls.length;
  if (c.imageBlobs?.length) return c.imageBlobs.length;
  if (c.imageUrls?.length) return c.imageUrls.length;
  return 1;
}

export function isStack(c: RadCase): boolean {
  return frameCount(c) > 1;
}

/** A case whose frames are DICOM files rather than flat images. */
export function isDicom(c: RadCase): boolean {
  return !!c.dicomUrls?.length;
}

export type ClickResult = "hit" | "near" | "miss";

export interface RegionOutcome {
  regionId: string;
  result: ClickResult;
  points: number;
  /** Distance from the click to the region edge, as a fraction of image diagonal. */
  distance: number;
  click: { x: number; y: number };
  /** Slice the click landed on, for placing the marker in a stack. */
  slice: number;
}

export interface CaseOutcome {
  caseId: string;
  title: string;
  modality: Modality;
  bodyRegion: BodyRegion;
  outcomes: RegionOutcome[];
  /** 0..100 before time bonus */
  baseScore: number;
  timeBonus: number;
  timedOut: boolean;
}

export interface RoundRecord {
  id: string;
  finishedAt: number;
  caseCount: number;
  totalScore: number;
  maxScore: number;
  hits: number;
  nears: number;
  misses: number;
  byModality: Record<string, { hits: number; total: number }>;
}

export interface ScoringSettings {
  /** Points for a click inside the region. */
  hitPoints: number;
  /** Max points for a close miss; scales linearly down to 0 at nearThreshold. */
  nearMaxPoints: number;
  /** Close-miss cutoff, as a fraction of the image diagonal. */
  nearThreshold: number;
  /** Hit radius around point-type regions, as a fraction of the image diagonal. */
  pointTolerance: number;
  /** Per-case countdown; 0 disables the timer. */
  timerSeconds: number;
  /** Max speed bonus, scaled by remaining time and score quality. */
  timerBonusMax: number;
}

export const DEFAULT_SCORING: ScoringSettings = {
  hitPoints: 100,
  nearMaxPoints: 60,
  nearThreshold: 0.12,
  pointTolerance: 0.045,
  timerSeconds: 0,
  timerBonusMax: 50,
};

/** Which pool a round draws from: everything, curated only, or personal only. */
export type CaseSource = "all" | "library" | "personal";

export interface RoundFilters {
  source: CaseSource;
  modalities: Modality[];
  subspecialties: Subspecialty[];
  difficulties: Difficulty[];
  shuffle: boolean;
}
