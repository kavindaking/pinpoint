import type { Difficulty, MediaQaReport, Modality, RadCase, Subspecialty } from "../types";

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

export interface AcquisitionPreparedMedia {
  imageUrl: string;
  sourceAssetUrl: string;
  preparedAt: string;
  mediaQa: MediaQaReport;
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
  libraryCaseId?: string;
  preparedMedia?: AcquisitionPreparedMedia;
  draftCase?: RadCase;
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

export async function loadAcquisitionHistory(id: string): Promise<AcquisitionRecord[]> {
  const response = await fetch(`/api/admin-acquisitions?id=${encodeURIComponent(id)}`, {
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error(await responseError(response));
  return ((await response.json()) as { history?: AcquisitionRecord[] }).history ?? [];
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

export async function saveAcquisitionBatch(records: AcquisitionDraft[]): Promise<AcquisitionRecord[]> {
  const response = await fetch("/api/admin-acquisitions", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ records }),
  });
  if (!response.ok) throw new Error(await responseError(response));
  return ((await response.json()) as { records?: AcquisitionRecord[] }).records ?? [];
}

export async function prepareAcquisitionMedia(
  record: Pick<AcquisitionRecord, "id" | "assetUrl" | "modality">,
): Promise<AcquisitionPreparedMedia> {
  if (!record.assetUrl) throw new Error("Add a direct original-file URL before preparing this candidate.");
  const requestPreparation = (browserSourceBase64?: string) => fetch("/api/admin-acquisition-prepare", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      candidateId: record.id,
      assetUrl: record.assetUrl,
      modality: record.modality,
      browserSourceBase64,
    }),
  });
  let response = await requestPreparation();
  if (!response.ok) {
    const message = await responseError(response);
    if (!message.includes("(429)")) throw new Error(message);

    const source = await fetch(record.assetUrl, { cache: "no-store", mode: "cors" });
    if (!source.ok) throw new Error(`The source image could not be downloaded (${source.status}).`);
    const declaredBytes = Number(source.headers.get("content-length") ?? 0);
    const maxFallbackBytes = 3 * 1024 * 1024;
    if (declaredBytes > maxFallbackBytes) {
      throw new Error("Wikimedia rate-limited the server and this image is too large for the browser fallback.");
    }
    const bytes = new Uint8Array(await source.arrayBuffer());
    if (!bytes.length || bytes.length > maxFallbackBytes) {
      throw new Error("The browser fallback image is empty or exceeds 3 MB.");
    }
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    response = await requestPreparation(btoa(binary));
  }
  if (!response.ok) throw new Error(await responseError(response));
  const prepared = ((await response.json()) as { preparedMedia?: AcquisitionPreparedMedia }).preparedMedia;
  if (!prepared) throw new Error("The server did not confirm the prepared image.");
  return prepared;
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

export function authoringReady(record: AcquisitionRecord): boolean {
  return Object.entries(record.checks).every(
    ([key, complete]) => key === "regionReviewed" || complete,
  );
}
