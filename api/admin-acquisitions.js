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
    checks,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
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
      res.status(200).json({ records: await readAll() });
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
