import type { Difficulty, Modality, Subspecialty } from "../types";

export const ACQUISITION_STATUSES = [
  "candidate",
  "licence-cleared",
  "image-qc",
  "clinical-review",
  "pilot",
  "approved",
  "rejected",
] as const;
export type AcquisitionStatus = (typeof ACQUISITION_STATUSES)[number];

export const ACQUISITION_LICENCES = [
  "unverified",
  "CC0",
  "Public domain",
  "CC BY 3.0",
  "CC BY 4.0",
  "CC BY-SA 3.0",
  "CC BY-SA 4.0",
  "Other",
] as const;
export type AcquisitionLicence = (typeof ACQUISITION_LICENCES)[number];

export interface AcquisitionChecks {
  licenceConfirmed: boolean;
  redistributionAllowed: boolean;
  attributionComplete: boolean;
  deidentified: boolean;
  originalQuality: boolean;
  noTeachingAnnotations: boolean;
  clinicalFindingConfirmed: boolean;
  regionReviewed: boolean;
}

export interface AcquisitionRecord {
  id: string;
  finding: string;
  status: AcquisitionStatus;
  repository: string;
  collection?: string;
  collectionDoi?: string;
  sourceUrl: string;
  assetUrl?: string;
  author?: string;
  licence: AcquisitionLicence;
  licenceUrl?: string;
  attribution?: string;
  modality: Modality;
  subspecialty: Subspecialty;
  targetDifficulty: Difficulty;
  reviewer?: string;
  notes?: string;
  checks: AcquisitionChecks;
  createdAt: string;
  updatedAt: string;
}

export const EMPTY_ACQUISITION_CHECKS: AcquisitionChecks = {
  licenceConfirmed: false,
  redistributionAllowed: false,
  attributionComplete: false,
  deidentified: false,
  originalQuality: false,
  noTeachingAnnotations: false,
  clinicalFindingConfirmed: false,
  regionReviewed: false,
};

export type AcquisitionDraft = Omit<AcquisitionRecord, "id" | "createdAt" | "updatedAt">;

async function responseError(response: Response): Promise<string> {
  try {
    return ((await response.json()) as { error?: string }).error ?? `Request failed (${response.status}).`;
  } catch {
    return `Request failed (${response.status}).`;
  }
}

export async function loadAcquisitions(): Promise<AcquisitionRecord[]> {
  const response = await fetch("/api/admin-acquisitions", {
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error(await responseError(response));
  return ((await response.json()) as { records?: AcquisitionRecord[] }).records ?? [];
}

export async function saveAcquisition(
  record: AcquisitionRecord | AcquisitionDraft,
): Promise<AcquisitionRecord> {
  const method = "id" in record ? "PUT" : "POST";
  const response = await fetch("/api/admin-acquisitions", {
    method,
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ record }),
  });
  if (!response.ok) throw new Error(await responseError(response));
  const saved = ((await response.json()) as { record?: AcquisitionRecord }).record;
  if (!saved) throw new Error("The server did not confirm the candidate save.");
  return saved;
}

export async function deleteAcquisition(id: string): Promise<void> {
  const response = await fetch("/api/admin-acquisitions", {
    method: "DELETE",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id }),
  });
  if (!response.ok) throw new Error(await responseError(response));
}

export function completedCheckCount(record: Pick<AcquisitionRecord, "checks">): number {
  return Object.values(record.checks).filter(Boolean).length;
}

export function publicationReady(record: AcquisitionRecord): boolean {
  return completedCheckCount(record) === Object.keys(record.checks).length;
}
