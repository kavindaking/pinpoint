import { get, put } from "@vercel/blob";
import { hasSameOrigin, isAdminRequest } from "../server/admin-auth.js";

const PATHNAME = "admin/case-overrides.json";
const MODALITIES = new Set(["X-ray", "CT", "MRI", "Ultrasound"]);
const BODY_REGIONS = new Set(["Chest", "Abdomen", "Head", "Spine", "Upper limb", "Lower limb", "Pelvis"]);
const SUBSPECIALTIES = new Set(["Chest", "MSK", "Neuro", "Abdominal", "Cardiac", "Head & Neck", "Pediatric", "Breast"]);
const DIFFICULTIES = new Set(["easy", "medium", "hard"]);

function boundedText(value, max, optional = false) {
  if (value == null && optional) return undefined;
  if (typeof value !== "string") throw new Error("Invalid text field.");
  const result = value.trim().slice(0, max);
  return optional && !result ? undefined : result;
}

function unit(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) throw new Error("Marking coordinates must be between 0 and 1.");
  return number;
}

function positiveUnit(value) {
  const number = unit(value);
  if (number <= 0) throw new Error("Marking dimensions must be greater than zero.");
  return number;
}

function shapeOf(value) {
  if (!value || typeof value !== "object") throw new Error("A marking shape is required.");
  if (value.kind === "point") return { kind: "point", x: unit(value.x), y: unit(value.y) };
  if (value.kind === "ellipse") {
    return { kind: "ellipse", cx: unit(value.cx), cy: unit(value.cy), rx: positiveUnit(value.rx), ry: positiveUnit(value.ry) };
  }
  if (value.kind === "rect") {
    return { kind: "rect", x: unit(value.x), y: unit(value.y), w: positiveUnit(value.w), h: positiveUnit(value.h) };
  }
  if (value.kind === "polygon" && Array.isArray(value.points) && value.points.length >= 3 && value.points.length <= 200) {
    return { kind: "polygon", points: value.points.map((point) => {
      if (!Array.isArray(point) || point.length !== 2) throw new Error("Invalid polygon point.");
      return [unit(point[0]), unit(point[1])];
    }) };
  }
  throw new Error("Unsupported marking shape.");
}

function sanitizeCase(value) {
  if (!value || typeof value !== "object" || !/^seed-[a-z0-9-]+$/i.test(String(value.id))) {
    throw new Error("Only bundled library cases can be edited here.");
  }
  if (!Array.isArray(value.regions) || value.regions.length < 1 || value.regions.length > 100) {
    throw new Error("Each case needs between 1 and 100 marked regions.");
  }
  if (!MODALITIES.has(value.modality) || !BODY_REGIONS.has(value.bodyRegion) || !SUBSPECIALTIES.has(value.subspecialty) || !DIFFICULTIES.has(value.difficulty)) {
    throw new Error("Invalid case classification.");
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
    credit: boundedText(value.credit, 500, true),
    regions: value.regions.map((region, index) => ({
      id: boundedText(region?.id || `region-${index + 1}`, 120),
      label: boundedText(region?.label, 160, true),
      slice: Math.max(0, Math.floor(Number(region?.slice) || 0)),
      shape: shapeOf(region?.shape),
    })),
    updatedAt: new Date().toISOString(),
  };
}

async function readStore() {
  const result = await get(PATHNAME, { access: "public", useCache: false });
  if (!result || result.statusCode !== 200) return { cases: {}, etag: undefined };
  try {
    const parsed = await new Response(result.stream).json();
    return {
      cases: parsed && typeof parsed.cases === "object" ? parsed.cases : {},
      etag: result.blob.etag,
    };
  } catch {
    return { cases: {}, etag: result.blob.etag };
  }
}

export default async function handler(req, res) {
  res.setHeader("cache-control", "no-store");

  if (req.method === "GET") {
    try {
      const store = await readStore();
      res.status(200).json({ overrides: store.cases });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (req.method !== "PUT") {
    res.setHeader("allow", "GET, PUT");
    res.status(405).json({ error: "Method not allowed." });
    return;
  }
  if (!hasSameOrigin(req) || !isAdminRequest(req)) {
    res.status(401).json({ error: "Admin authentication required." });
    return;
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const override = sanitizeCase(body?.case);
    const current = await readStore();
    const cases = { ...current.cases, [override.id]: override };
    await put(PATHNAME, JSON.stringify({ version: 1, updatedAt: override.updatedAt, cases }), {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 60,
      contentType: "application/json",
      ...(current.etag ? { ifMatch: current.etag } : {}),
    });
    res.status(200).json({ saved: true, override });
  } catch (error) {
    const status = error?.name === "BlobPreconditionFailedError" ? 409 : 400;
    res.status(status).json({ error: error instanceof Error ? error.message : String(error) });
  }
}
