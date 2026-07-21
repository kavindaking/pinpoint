import { randomUUID } from "node:crypto";
import { get, list, put } from "@vercel/blob";
import { hasSameOrigin, isAdminRequest } from "../server/admin-auth.js";

const PREFIX = "library/cases/";
const ENUMS = {
  modality: new Set(["X-ray", "CT", "MRI", "Ultrasound"]),
  bodyRegion: new Set(["Chest", "Abdomen", "Head", "Spine", "Upper limb", "Lower limb", "Pelvis"]),
  subspecialty: new Set(["Chest", "MSK", "Neuro", "Abdominal", "Cardiac", "Head & Neck", "Pediatric", "Breast"]),
  difficulty: new Set(["easy", "medium", "hard"]),
};
const text = (value, max, optional = false) => {
  if (value == null && optional) return undefined;
  if (typeof value !== "string") throw new Error("Invalid text field.");
  const result = value.trim().slice(0, max);
  if (!optional && !result) throw new Error("A required field is missing.");
  return optional && !result ? undefined : result;
};
const unit = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1) throw new Error("Invalid marking coordinate.");
  return n;
};
function shape(value) {
  if (value?.kind === "point") return { kind: "point", x: unit(value.x), y: unit(value.y) };
  if (value?.kind === "ellipse") return { kind: "ellipse", cx: unit(value.cx), cy: unit(value.cy), rx: unit(value.rx), ry: unit(value.ry) };
  if (value?.kind === "rect") return { kind: "rect", x: unit(value.x), y: unit(value.y), w: unit(value.w), h: unit(value.h) };
  if (value?.kind === "polygon" && Array.isArray(value.points) && value.points.length >= 3) return { kind: "polygon", points: value.points.slice(0, 200).map((p) => [unit(p[0]), unit(p[1])]) };
  throw new Error("Invalid marking shape.");
}
function mediaUrl(value, optional = true) {
  const raw = text(value, 2000, optional);
  if (!raw) return undefined;
  const url = new URL(raw);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".public.blob.vercel-storage.com") || !url.pathname.startsWith("/library/media/")) throw new Error("Invalid library media URL.");
  return url.toString();
}
function httpsUrl(value, optional = true) {
  const raw = text(value, 2000, optional);
  if (!raw) return undefined;
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error("Attribution links must use HTTPS.");
  return url.toString();
}
function sanitize(value) {
  if (!value || !/^library-[a-z0-9-]+$/i.test(String(value.id))) throw new Error("Invalid library case ID.");
  for (const [key, values] of Object.entries(ENUMS)) if (!values.has(value[key])) throw new Error(`Invalid ${key}.`);
  if (!Array.isArray(value.regions) || value.regions.length < 1 || value.regions.length > 100) throw new Error("Add at least one marking.");
  const imageUrls = Array.isArray(value.imageUrls) ? value.imageUrls.map((url) => mediaUrl(url, false)) : undefined;
  const dicomUrls = Array.isArray(value.dicomUrls) ? value.dicomUrls.map((url) => mediaUrl(url, false)) : undefined;
  const imageUrl = mediaUrl(value.imageUrl);
  if (!imageUrl && !imageUrls?.length && !dicomUrls?.length) throw new Error("The case needs uploaded media.");
  return {
    id: String(value.id), title: text(value.title, 160), stem: text(value.stem, 500, true), explanation: text(value.explanation, 3000),
    modality: value.modality, bodyRegion: value.bodyRegion, subspecialty: value.subspecialty, difficulty: value.difficulty,
    regions: value.regions.map((r, i) => ({ id: text(r?.id || `region-${i + 1}`, 120), label: text(r?.label, 160, true), slice: Math.max(0, Math.floor(Number(r?.slice) || 0)), shape: shape(r?.shape) })),
    imageUrl, imageUrls, dicomUrls, dicomFrameCount: dicomUrls?.length ? Math.max(dicomUrls.length, Math.floor(Number(value.dicomFrameCount) || 0)) : undefined,
    posterUrl: mediaUrl(value.posterUrl), credit: text(value.credit, 500, true), creditUrl: httpsUrl(value.creditUrl), seed: true,
    createdAt: Number(value.createdAt) || Date.now(), updatedAt: new Date().toISOString(),
  };
}
async function readJson(url) {
  const result = await get(url, { access: "public", useCache: false });
  if (!result || result.statusCode !== 200) return null;
  return new Response(result.stream).json();
}
async function readAll() {
  const latest = new Map(); let cursor;
  do {
    const page = await list({ prefix: PREFIX, limit: 1000, cursor });
    for (const blob of page.blobs) {
      const id = blob.pathname.slice(PREFIX.length).split("/")[0];
      if (!/^library-[a-z0-9-]+$/i.test(id)) continue;
      const old = latest.get(id); if (!old || blob.uploadedAt > old.uploadedAt) latest.set(id, blob);
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  const cases = [];
  await Promise.all([...latest.values()].map(async (blob) => { try { const data = await readJson(blob.url); if (data?.case) cases.push(data.case); } catch {} }));
  return cases.sort((a, b) => a.createdAt - b.createdAt);
}
export default async function handler(req, res) {
  res.setHeader("cache-control", "no-store");
  if (req.method === "GET") return res.status(200).json({ cases: await readAll() });
  if (req.method !== "PUT") return res.status(405).json({ error: "Method not allowed." });
  if (!hasSameOrigin(req) || !isAdminRequest(req)) return res.status(401).json({ error: "Admin authentication required." });
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const radCase = sanitize(body?.case);
    await put(`${PREFIX}${radCase.id}/${Date.now()}-${randomUUID()}.json`, JSON.stringify({ version: 1, case: radCase }), { access: "public", addRandomSuffix: false, allowOverwrite: false, cacheControlMaxAge: 60, contentType: "application/json" });
    res.status(200).json({ case: radCase });
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : String(error) }); }
}
