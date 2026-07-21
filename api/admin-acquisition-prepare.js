import { randomUUID } from "node:crypto";
import { put } from "@vercel/blob";
import { hasSameOrigin, isAdminRequest } from "../server/admin-auth.js";
import {
  fetchAllowedSourceImage,
  inspectSourceImage,
  readLimitedBody,
  sourceImageQa,
} from "../server/source-image.js";

const MODALITIES = new Set(["X-ray", "CT", "MRI", "Ultrasound"]);

export default async function handler(req, res) {
  res.setHeader("cache-control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    res.status(405).json({ error: "Method not allowed." });
    return;
  }
  if (!isAdminRequest(req)) {
    res.status(401).json({ error: "Admin authentication required." });
    return;
  }
  if (!hasSameOrigin(req)) {
    res.status(403).json({ error: "Invalid request origin." });
    return;
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body ?? {};
    const candidateId = String(body.candidateId ?? "");
    if (!/^candidate-[a-z0-9-]+$/i.test(candidateId)) throw new Error("Invalid candidate identifier.");
    if (!MODALITIES.has(body.modality)) throw new Error("Invalid candidate modality.");

    const { response, finalUrl } = await fetchAllowedSourceImage(body.assetUrl);
    const bytes = await readLimitedBody(response);
    const details = inspectSourceImage(bytes);
    const mediaQa = sourceImageQa(bytes, details, body.modality);
    const libraryId = `library-${candidateId.replace(/^candidate-/, "")}`;
    const pathname = `library/media/${libraryId}/${randomUUID()}/images/00000.${details.extension}`;
    const uploaded = await put(pathname, bytes, {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: false,
      cacheControlMaxAge: 31536000,
      contentType: details.mimeType,
    });

    res.status(200).json({
      preparedMedia: {
        imageUrl: uploaded.url,
        sourceAssetUrl: finalUrl,
        preparedAt: new Date().toISOString(),
        mediaQa,
      },
    });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
}
