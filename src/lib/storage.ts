import type { RadCase, RoundRecord, ScoringSettings } from "../types";
import { DEFAULT_SCORING, inferSubspecialty } from "../types";
import { SEED_CASES } from "../data/seedCases";
import { parseDicomFrames } from "./dicom";

/**
 * Persistence is fully client-side so the app can be hosted as static files:
 *   - cases (including uploaded image blobs) live in IndexedDB,
 *   - settings, theme, and round history live in localStorage.
 * Seed cases are copied into IndexedDB on first run; a tombstone list keeps
 * deleted seeds from resurrecting on the next visit.
 */

const DB_NAME = "pinpoint-db";
const DB_VERSION = 1;
const CASES = "cases";

const LS_SETTINGS = "pinpoint:settings";
const LS_HISTORY = "pinpoint:history";
const LS_SEED_TOMBSTONES = "pinpoint:deleted-seeds";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(CASES, { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(CASES, mode);
        const req = run(t.objectStore(CASES));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export async function getAllCases(): Promise<RadCase[]> {
  await ensureSeeds();
  const all = await tx<RadCase[]>("readonly", (s) => s.getAll() as IDBRequest<RadCase[]>);
  // Cases saved before the subspecialty field existed get a best-guess value.
  for (const c of all) {
    let changed = false;
    if (!c.subspecialty) {
      c.subspecialty = inferSubspecialty(c.bodyRegion);
      changed = true;
    }
    // Cases imported before multi-frame support recorded one blob as one
    // slice. Recount the embedded frames from the retained original files.
    if (c.dicomBlobs?.length && !c.dicomFrameCount) {
      let count = 0;
      for (const blob of c.dicomBlobs) {
        try {
          count += parseDicomFrames(await blob.arrayBuffer()).length;
        } catch {
          /* Leave unreadable legacy files unchanged. */
        }
      }
      if (count > 0) {
        c.dicomFrameCount = count;
        changed = true;
      }
    }
    if (changed) await saveCase(c);
  }
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

export async function saveCase(c: RadCase): Promise<void> {
  await tx("readwrite", (s) => s.put(c));
}

export async function deleteCase(c: RadCase): Promise<void> {
  await tx("readwrite", (s) => s.delete(c.id));
  if (c.seed) {
    const dead = getTombstones();
    if (!dead.includes(c.id)) {
      dead.push(c.id);
      localStorage.setItem(LS_SEED_TOMBSTONES, JSON.stringify(dead));
    }
  }
}

function getTombstones(): string[] {
  try {
    return JSON.parse(localStorage.getItem(LS_SEED_TOMBSTONES) ?? "[]");
  } catch {
    return [];
  }
}

/**
 * Keep the curated Library in step with the shipped seed definitions.
 * Every non-deleted seed is written on load, so image or region fixes in
 * code reach returning visitors without a manual "Restore bundled". This is
 * safe because curated cases are read-only in the UI, so a stored copy is
 * never something the user edited; deletions are honored via tombstones.
 */
async function ensureSeeds(): Promise<void> {
  const dead = getTombstones();
  for (const c of SEED_CASES) {
    if (!dead.includes(c.id)) await saveCase(c);
  }
}

/** Bring back every bundled seed case, clearing tombstones. */
export async function restoreSeeds(): Promise<void> {
  localStorage.removeItem(LS_SEED_TOMBSTONES);
  for (const c of SEED_CASES) await saveCase(c);
}

export function loadSettings(): ScoringSettings {
  try {
    const raw = localStorage.getItem(LS_SETTINGS);
    if (raw) return { ...DEFAULT_SCORING, ...JSON.parse(raw) };
  } catch {
    /* fall through to defaults */
  }
  return { ...DEFAULT_SCORING };
}

export function saveSettings(s: ScoringSettings): void {
  localStorage.setItem(LS_SETTINGS, JSON.stringify(s));
}

export function loadHistory(): RoundRecord[] {
  try {
    return JSON.parse(localStorage.getItem(LS_HISTORY) ?? "[]");
  } catch {
    return [];
  }
}

export function appendHistory(r: RoundRecord): void {
  const all = loadHistory();
  all.push(r);
  // Keep the last 200 rounds; localStorage is not a data warehouse.
  localStorage.setItem(LS_HISTORY, JSON.stringify(all.slice(-200)));
}

export function clearHistory(): void {
  localStorage.removeItem(LS_HISTORY);
}

/* ---- import / export ------------------------------------------------- */

interface ExportedCase
  extends Omit<RadCase, "imageBlob" | "imageBlobs" | "dicomBlobs" | "posterBlob"> {
  imageData?: string; // single-image data URL
  imageDatas?: string[]; // stack slice data URLs
  dicomDatas?: string[]; // original uploaded DICOM slices
  posterData?: string; // rendered DICOM thumbnail
}

export async function exportCases(cases: RadCase[]): Promise<string> {
  const out: ExportedCase[] = [];
  for (const c of cases) {
    const { imageBlob, imageBlobs, dicomBlobs, posterBlob, ...rest } = c;
    const entry: ExportedCase = { ...rest };
    if (imageBlob) entry.imageData = await blobToDataUrl(imageBlob);
    if (imageBlobs?.length) {
      entry.imageDatas = await Promise.all(imageBlobs.map(blobToDataUrl));
    }
    if (dicomBlobs?.length) {
      entry.dicomDatas = await Promise.all(dicomBlobs.map(blobToDataUrl));
    }
    if (posterBlob) entry.posterData = await blobToDataUrl(posterBlob);
    out.push(entry);
  }
  return JSON.stringify({ app: "pinpoint", version: 1, cases: out }, null, 2);
}

export async function parseImportedCases(json: string): Promise<RadCase[]> {
  const parsed = JSON.parse(json);
  if (parsed?.app !== "pinpoint" || !Array.isArray(parsed.cases)) {
    throw new Error("Not a Pinpoint case file");
  }
  const cases: RadCase[] = [];
  for (const entry of parsed.cases as ExportedCase[]) {
    const { imageData, imageDatas, dicomDatas, posterData, ...rest } = entry;
    if (!rest.id || !rest.title || !Array.isArray(rest.regions)) continue;
    const c: RadCase = { ...rest };
    if (imageData) c.imageBlob = dataUrlToBlob(imageData);
    if (imageDatas?.length) c.imageBlobs = imageDatas.map(dataUrlToBlob);
    if (dicomDatas?.length) c.dicomBlobs = dicomDatas.map(dataUrlToBlob);
    if (posterData) c.posterBlob = dataUrlToBlob(posterData);
    // Imported cases are personal, never curated.
    delete c.seed;
    if (
      !c.imageBlob &&
      !c.imageUrl &&
      !c.imageBlobs?.length &&
      !c.imageUrls?.length &&
      !c.dicomBlobs?.length &&
      !c.dicomUrls?.length
    )
      continue;
    cases.push(c);
  }
  return cases;
}

export async function importCases(json: string): Promise<number> {
  const cases = await parseImportedCases(json);
  for (const radCase of cases) await saveCase(radCase);
  return cases.length;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(",");
  const mime = head.match(/data:(.*?);/)?.[1] ?? "image/png";
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
