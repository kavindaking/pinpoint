import {
  ACQUISITION_LICENCES,
  EMPTY_ACQUISITION_CHECKS,
  type AcquisitionDraft,
  type AcquisitionLicence,
} from "./acquisition";
import { DIFFICULTIES, MODALITIES, SUBSPECIALTIES, type Difficulty, type Modality, type Subspecialty } from "../types";

export const ACQUISITION_TEMPLATE_COLUMNS = [
  "finding", "repository", "sourceUrl", "assetUrl", "author", "licence", "licenceUrl",
  "attribution", "modality", "subspecialty", "targetDifficulty", "collection", "collectionDoi",
  "reviewer", "notes",
] as const;

function csvRows(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let field = ""; let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { field += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) { row.push(field); field = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field); if (row.some((value) => value.trim())) rows.push(row); row = []; field = "";
    } else field += char;
  }
  row.push(field); if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function draftOf(raw: Record<string, unknown>, row: number): AcquisitionDraft {
  const required = (key: string) => {
    const value = String(raw[key] ?? "").trim();
    if (!value) throw new Error(`Row ${row}: ${key} is required.`);
    return value;
  };
  const value = (key: string) => String(raw[key] ?? "").trim() || undefined;
  const licence = required("licence") as AcquisitionLicence;
  const modality = required("modality") as Modality;
  const subspecialty = required("subspecialty") as Subspecialty;
  const targetDifficulty = required("targetDifficulty") as Difficulty;
  if (!ACQUISITION_LICENCES.includes(licence)) throw new Error(`Row ${row}: invalid licence.`);
  if (!MODALITIES.includes(modality)) throw new Error(`Row ${row}: invalid modality.`);
  if (!SUBSPECIALTIES.includes(subspecialty)) throw new Error(`Row ${row}: invalid subspecialty.`);
  if (!DIFFICULTIES.includes(targetDifficulty)) throw new Error(`Row ${row}: invalid difficulty.`);
  return {
    finding: required("finding"), repository: required("repository"), sourceUrl: required("sourceUrl"),
    assetUrl: value("assetUrl"), author: value("author"), licence, licenceUrl: value("licenceUrl"),
    attribution: value("attribution"), modality, subspecialty, targetDifficulty,
    collection: value("collection"), collectionDoi: value("collectionDoi"), reviewer: value("reviewer"),
    notes: value("notes"), status: "candidate", checks: { ...EMPTY_ACQUISITION_CHECKS },
  };
}

export function parseAcquisitionImport(text: string, filename: string): AcquisitionDraft[] {
  if (filename.toLowerCase().endsWith(".json")) {
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) throw new Error("JSON imports must contain an array.");
    return parsed.map((item, index) => draftOf(item as Record<string, unknown>, index + 1));
  }
  const rows = csvRows(text);
  if (rows.length < 2) throw new Error("The CSV has no candidate rows.");
  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1).map((values, index) => draftOf(
    Object.fromEntries(headers.map((header, column) => [header, values[column] ?? ""])), index + 2,
  ));
}

export function acquisitionTemplateCsv(): string {
  return `${ACQUISITION_TEMPLATE_COLUMNS.join(",")}\n`;
}
