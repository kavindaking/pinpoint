import { handleUpload } from "@vercel/blob/client";

/**
 * Authorizes direct browser-to-Blob uploads. The client calls upload() with
 * this route as its handler; we hand back a scoped, short-lived token so the
 * case-set JSON streams straight to Vercel Blob (bypassing the 4.5 MB
 * function body limit) and lands on the edge CDN for fast global reads.
 *
 * Plain JS on purpose: Vercel's Node builder compiles TypeScript functions
 * with the project's local TypeScript, and the native TS 7 preview used by
 * the app build is not compatible with it.
 *
 * @param {import('@vercel/node').VercelRequest} req
 * @param {import('@vercel/node').VercelResponse} res
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    const result = await handleUpload({
      request: req,
      body: req.body,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith("sets/") || !pathname.endsWith(".json")) {
          throw new Error("Uploads are limited to shared case sets.");
        }
        return {
          allowedContentTypes: ["application/json"],
          addRandomSuffix: false,
          allowOverwrite: true,
          maximumSizeInBytes: 40 * 1024 * 1024,
        };
      },
      // No post-upload bookkeeping needed; the blob is the source of truth.
      onUploadCompleted: async () => {},
    });
    res.status(200).json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
}
