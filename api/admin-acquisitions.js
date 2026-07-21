import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { list, put } from "@vercel/blob";
import { hasSameOrigin, isAdminRequest } from "../server/admin-auth.js";

const PREFIX = "admin/acquisitions/";
const STATUSES = new Set([
  "candidate",
  "licence-cleared",
  "image-qc",
  "clinical-review",
  "pilot",
  "approved",
  "rejected",
]);
const MODALITIES = new Set(["X-ray", "CT", "MRI", "Ultrasound"]);
const SUBSPECIALTIES = new Set([
  "Chest",
  "MSK",
  "Neuro",
  "Abdominal",
  "Cardiac",
  "Head & Neck",
  "Pediatric",
  "Breast",
]);
const DIFFICULTIES = new Set(["easy", "medium", "hard"]);
const BODY_REGIONS = new Set(["Chest", "Abdomen", "Head", "Spine", "Upper limb", "Lower limb", "Pelvis"]);
const LICENCES = new Set([
  "unverified",
  "CC0",
  "Public domain",
  "CC BY 3.0",
  "CC BY 4.0",
  "CC BY-SA 3.0",
  "CC BY-SA 4.0",
  "Other",
]);
const CHECK_KEYS = [
  "licenceConfirmed",
  "redistributionAllowed",
  "attributionComplete",
  "deidentified",
  "originalQuality",
  "noTeachingAnnotations",
  "clinicalFindingConfirmed",
  "regionReviewed",
];

function encryptionKey() {
  const secret = process.env.ACQUISITIONS_ENCRYPTION_SECRET || process.env.ADMIN_PASSWORD;
  if (!secret) throw new Error("Acquisition encryption is not configured.");
  return createHash("sha256").update(`pinpoint-acquisitions:${secret}`).digest();
}

function encryptPayload(payload) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  return JSON.stringify({
    version: 1,
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  });
}

function decryptPayload(envelope) {
  if (
    !envelope ||
    envelope.version !== 1 ||
    envelope.algorithm !== "aes-256-gcm" ||
    typeof envelope.iv !== "string" ||
    typeof envelope.tag !== "string" ||
    typeof envelope.ciphertext !== "string"
  ) {
    throw new Error("Invalid encrypted acquisition record.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(envelope.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8"));
}

function boundedText(value, max, optional = false) {
  if (value == null && optional) return undefined;
  if (typeof value !== "string") throw new Error("Invalid text field.");
  const result = value.trim().slice(0, max);
  if (!optional && !result) throw new Error("A required field is missing.");
  return optional && !result ? undefined : result;
}

function safeUrl(value, optional = true) {
  const text = boundedText(value, 2000, optional);
  if (!text) return undefined;
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    throw new Error("Source links must be valid web addresses.");
  }
  if (parsed.protocol !== "https:") throw new Error("Source links must use HTTPS.");
  return parsed.toString();
}

function enumValue(value, allowed, label) {
  if (!allowed.has(value)) throw new Error(`Invalid ${label}.`);
  return value;
}

function sanitizeRecord(value, existing = null) {
  if (!value || typeof value !== "object") throw new Error("Candidate details are required.");
  const id = existing?.id ?? `candidate-${randomUUID()}`;
  if (!/^candidate-[a-z0-9-]+$/i.test(id)) throw new Error("Invalid candidate identifier.");
  const checks = Object.fromEntries(CHECK_KEYS.map((key) => [key, Boolean(value.checks?.[key])]));
  const status = enumValue(value.status ?? "candidate", STATUSES, "review status");
  if (status === "approved" && !CHECK_KEYS.every((key) => checks[key])) {
    throw new Error("Every publication gate must be complete before approval.");
  }
  return {
    id,
    finding: boundedText(value.finding, 180),
    status,
    repository: boundedText(value.repository, 120),
    collection: boundedText(value.collection, 240, true),
    collectionDoi: boundedText(value.collectionDoi, 240, true),
    sourceUrl: safeUrl(value.sourceUrl, false),
    assetUrl: safeUrl(value.assetUrl, true),
    author: boundedText(value.author, 240, true),
    licence: enumValue(value.licence ?? "unverified", LICENCES, "licence"),
    licenceUrl: safeUrl(value.licenceUrl, true),
    attribution: boundedText(value.attribution, 1000, true),
    modality: enumValue(value.modality ?? "X-ray", MODALITIES, "modality"),
    subspecialty: enumValue(value.subspecialty ?? "Chest", SUBSPECIALTIES, "subspecialty"),
    targetDifficulty: enumValue(
      value.targetDifficulty ?? "medium",
      DIFFICULTIES,
      "target difficulty",
    ),
    reviewer: boundedText(value.reviewer, 160, true),
    notes: boundedText(value.notes, 4000, true),
    libraryCaseId: boundedText(value.libraryCaseId, 160, true),
    preparedMedia: sanitizePreparedMedia(value.preparedMedia),
    draftCase: sanitizeDraftCase(value.draftCase),
    checks,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function sanitizeMediaQa(value) {
  if (!value || !/^[a-f0-9]{64}$/i.test(String(value.fingerprint)) || value.status === "fail") {
    throw new Error("Prepared media needs a passing media QA result.");
  }
  return {
    status: value.status === "warning" ? "warning" : "pass",
    checkedAt: boundedText(value.checkedAt, 60),
    fileCount: Math.max(1, Math.floor(Number(value.fileCount) || 0)),
    totalBytes: Math.max(1, Math.floor(Number(value.totalBytes) || 0)),
    minWidth: Math.max(0, Math.floor(Number(value.minWidth) || 0)) || undefined,
    minHeight: Math.max(0, Math.floor(Number(value.minHeight) || 0)) || undefined,
    fingerprint: String(value.fingerprint).toLowerCase(),
    warnings: Array.isArray(value.warnings) ? value.warnings.slice(0, 20).map((item) => boundedText(item, 300)) : [],
    errors: [],
  };
}

function sanitizePreparedMedia(value) {
  if (value == null) return undefined;
  if (!value || typeof value !== "object") throw new Error("Invalid prepared media.");
  return {
    imageUrl: safeUrl(value.imageUrl, false),
    sourceAssetUrl: safeUrl(value.sourceAssetUrl, false),
    preparedAt: boundedText(value.preparedAt, 60),
    mediaQa: sanitizeMediaQa(value.mediaQa),
  };
}

function sanitizeDraftCase(value) {
  if (value == null) return undefined;
  if (!value || typeof value !== "object" || !/^library-[a-z0-9-]+$/i.test(String(value.id))) {
    throw new Error("Invalid case draft.");
  }
  if (!MODALITIES.has(value.modality) || !BODY_REGIONS.has(value.bodyRegion) || !SUBSPECIALTIES.has(value.subspecialty) || !DIFFICULTIES.has(value.difficulty)) {
    throw new Error("Invalid draft classification.");
  }
  if (!Array.isArray(value.regions) || value.regions.length < 1 || value.regions.length > 100) {
    throw new Error("The case draft needs between 1 and 100 marked regions.");
  }
  const serializedRegions = JSON.stringify(value.regions);
  if (serializedRegions.length > 100000) throw new Error("The case marking is too large.");
  const urls = (items) => Array.isArray(items) ? items.slice(0, 1000).map((item) => safeUrl(item, false)) : undefined;
  const imageUrl = safeUrl(value.imageUrl, true);
  const imageUrls = urls(value.imageUrls);
  const dicomUrls = urls(value.dicomUrls);
  if (!imageUrl && !imageUrls?.length && !dicomUrls?.length) throw new Error("The case draft has no uploaded media.");
  if (!value.mediaQa || !/^[a-f0-9]{64}$/i.test(String(value.mediaQa.fingerprint)) || value.mediaQa.status === "fail") {
    throw new Error("The case draft needs a passing media QA result.");
  }
  return {
    id: String(value.id),
    title: boundedText(value.title, 160),
    stem: boundedText(value.stem, 500, true),
    explanation: boundedText(value.explanation, 3000),
    modality: value.modality,
    bodyRegion: value.bodyRegion,
    subspecialty: value.subspecialty,
    difficulty: value.difficulty,
    regions: JSON.parse(serializedRegions),
    imageUrl,
    imageUrls,
    dicomUrls,
    dicomFrameCount: Math.max(0, Math.floor(Number(value.dicomFrameCount) || 0)) || undefined,
    posterUrl: safeUrl(value.posterUrl, true),
    credit: boundedText(value.credit, 500, true),
    creditUrl: safeUrl(value.creditUrl, true),
    mediaQa: sanitizeMediaQa(value.mediaQa),
    seed: true,
    createdAt: Number(value.createdAt) || Date.now(),
  };
}

async function readJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) return null;
  return decryptPayload(await response.json());
}

async function readAll() {
  const latest = new Map();
  let cursor;
  do {
    const page = await list({ prefix: PREFIX, limit: 1000, cursor });
    for (const blob of page.blobs) {
      const relative = blob.pathname.slice(PREFIX.length);
      const id = relative.split("/")[0];
      if (!/^candidate-[a-z0-9-]+$/i.test(id)) continue;
      const previous = latest.get(id);
      if (!previous || blob.uploadedAt > previous.uploadedAt) latest.set(id, blob);
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  const records = [];
  await Promise.all(
    [...latest.values()].map(async (blob) => {
      try {
        const payload = await readJson(blob.url);
        if (payload?.record && !payload.deleted) records.push(payload.record);
      } catch {
        // Ignore a damaged historical version and keep the queue available.
      }
    }),
  );
  return records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function readHistory(id) {
  const page = await list({ prefix: `${PREFIX}${id}/`, limit: 100 });
  const versions = [];
  for (const blob of [...page.blobs].sort((a, b) => b.uploadedAt - a.uploadedAt).slice(0, 50)) {
    try {
      const payload = await readJson(blob.url);
      if (payload?.record) versions.push(payload.record);
    } catch {
      // Skip an unreadable historical version without hiding the rest.
    }
  }
  return versions;
}

async function saveVersion(id, payload) {
  await put(`${PREFIX}${id}/${Date.now()}-${randomUUID()}.json`, encryptPayload(payload), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: false,
    cacheControlMaxAge: 60,
    contentType: "application/json",
  });
}

export default async function handler(req, res) {
  res.setHeader("cache-control", "no-store");
  if (!isAdminRequest(req)) {
    res.status(401).json({ error: "Admin authentication required." });
    return;
  }

  if (req.method === "GET") {
    try {
      const id = typeof req.query?.id === "string" ? req.query.id : "";
      if (id) {
        if (!/^candidate-[a-z0-9-]+$/i.test(id)) throw new Error("Invalid candidate identifier.");
        res.status(200).json({ history: await readHistory(id) });
      } else {
        res.status(200).json({ records: await readAll() });
      }
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (!hasSameOrigin(req)) {
    res.status(403).json({ error: "Invalid request origin." });
    return;
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body ?? {};
    if (req.method === "POST") {
      if (Array.isArray(body.records)) {
        if (body.records.length < 1 || body.records.length > 100) throw new Error("Import between 1 and 100 candidates at a time.");
        const records = body.records.map((candidate) => sanitizeRecord(candidate));
        const existing = await readAll();
        const seen = new Set(existing.map((record) => record.sourceUrl));
        for (const record of records) {
          if (seen.has(record.sourceUrl)) throw new Error(`Duplicate source page: ${record.sourceUrl}`);
          seen.add(record.sourceUrl);
        }
        await Promise.all(records.map((record) => saveVersion(record.id, { version: 1, record })));
        res.status(201).json({ records });
        return;
      }
      const record = sanitizeRecord(body.record);
      await saveVersion(record.id, { version: 1, record });
      res.status(201).json({ record });
      return;
    }
    if (req.method === "PUT") {
      const records = await readAll();
      const existing = records.find((record) => record.id === body.record?.id);
      if (!existing) throw new Error("Candidate not found.");
      const record = sanitizeRecord(body.record, existing);
      await saveVersion(record.id, { version: 1, record });
      res.status(200).json({ record });
      return;
    }
    if (req.method === "DELETE") {
      const id = String(body.id ?? "");
      if (!/^candidate-[a-z0-9-]+$/i.test(id)) throw new Error("Invalid candidate identifier.");
      await saveVersion(id, { version: 1, deleted: true, deletedAt: new Date().toISOString() });
      res.status(200).json({ deleted: true });
      return;
    }
    res.setHeader("allow", "GET, POST, PUT, DELETE");
    res.status(405).json({ error: "Method not allowed." });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
}
