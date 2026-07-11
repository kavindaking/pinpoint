import { list } from "@vercel/blob";
import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * Resolves a short share code to its case-set JSON on the Blob CDN.
 * GET /api/share?id=<code> -> 302 redirect to the public blob URL, so the
 * browser fetches the payload straight from the edge.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const raw = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  const id = (raw ?? "").replace(/[^a-zA-Z0-9_-]/g, "");
  if (!id) {
    res.status(400).json({ error: "Missing share code." });
    return;
  }
  try {
    const pathname = `sets/${id}.json`;
    const { blobs } = await list({ prefix: pathname });
    const hit = blobs.find((b) => b.pathname === pathname);
    if (!hit) {
      res.status(404).json({ error: "No shared set with that code." });
      return;
    }
    res.setHeader("cache-control", "public, max-age=30");
    res.redirect(302, hit.url);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}
