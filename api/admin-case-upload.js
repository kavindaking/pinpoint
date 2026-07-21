import { handleUpload } from "@vercel/blob/client";
import { isAdminRequest } from "../server/admin-auth.js";

const TYPES = ["image/jpeg", "image/png", "image/webp", "application/dicom", "application/octet-stream"];

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  try {
    const result = await handleUpload({
      request: req,
      body: req.body,
      onBeforeGenerateToken: async (pathname) => {
        if (!isAdminRequest(req)) throw new Error("Admin authentication required.");
        if (!/^library\/media\/library-[a-z0-9-]+\/[a-z0-9-]+\/(images|dicom|poster)\//i.test(pathname)) {
          throw new Error("Invalid library media path.");
        }
        return {
          allowedContentTypes: TYPES,
          addRandomSuffix: false,
          allowOverwrite: false,
          maximumSizeInBytes: 64 * 1024 * 1024,
        };
      },
      onUploadCompleted: async () => {},
    });
    res.status(200).json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
}
