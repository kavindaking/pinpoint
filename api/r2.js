import {
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createClient } from "@supabase/supabase-js";

const MAX_OBJECTS = 1000;
const MAX_OBJECT_BYTES = 64 * 1024 * 1024;
const MAX_CASE_BYTES = 512 * 1024 * 1024;
const SIGNED_URL_SECONDS = 10 * 60;
const ALLOWED_CONTENT_TYPES = new Set([
  "application/dicom",
  "application/octet-stream",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function env(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function r2Client() {
  const accountId = env("R2_ACCOUNT_ID");
  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env("R2_ACCESS_KEY_ID"),
      secretAccessKey: env("R2_SECRET_ACCESS_KEY"),
    },
  });
}

async function authenticatedUser(req) {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return null;
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key =
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
    process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase server configuration is missing");
  const client = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error) return null;
  return data.user;
}

function validCaseId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,120}$/.test(value);
}

function validObjectName(value) {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 180 &&
    /^[A-Za-z0-9._/-]+$/.test(value) &&
    !value.includes("..") &&
    !value.startsWith("/")
  );
}

function parseBody(req) {
  if (typeof req.body === "string") return JSON.parse(req.body);
  return req.body ?? {};
}

export default async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "DELETE") {
    res.setHeader("Allow", "POST, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const user = await authenticatedUser(req);
    if (!user) return res.status(401).json({ error: "Sign in required" });

    const body = parseBody(req);
    const { action, caseId } = body;
    if (!validCaseId(caseId)) return res.status(400).json({ error: "Invalid case ID" });
    const prefix = `users/${user.id}/cases/${caseId}/`;
    const bucket = env("R2_BUCKET_NAME");
    const client = r2Client();

    if (req.method === "POST" && (action === "upload" || action === "download")) {
      if (!Array.isArray(body.objects) || body.objects.length > MAX_OBJECTS) {
        return res.status(400).json({ error: "Invalid object list" });
      }
      if (body.objects.some((object) => !validObjectName(object.name))) {
        return res.status(400).json({ error: "Invalid object name" });
      }

      if (action === "upload") {
        const sizes = body.objects.map((object) => Number(object.size));
        if (
          sizes.some((size) => !Number.isSafeInteger(size) || size <= 0 || size > MAX_OBJECT_BYTES) ||
          sizes.reduce((total, size) => total + size, 0) > MAX_CASE_BYTES
        ) {
          return res.status(413).json({ error: "Case upload is too large" });
        }
        if (
          body.objects.some(
            (object) => !ALLOWED_CONTENT_TYPES.has(object.contentType || "application/octet-stream"),
          )
        ) {
          return res.status(415).json({ error: "Unsupported file type" });
        }
      }

      const signed = await Promise.all(
        body.objects.map(async (object) => {
          const key = `${prefix}${object.name}`;
          if (action === "upload") {
            const contentType = object.contentType || "application/octet-stream";
            const url = await getSignedUrl(
              client,
              new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
              { expiresIn: SIGNED_URL_SECONDS },
            );
            return { key, url, contentType };
          }
          const url = await getSignedUrl(
            client,
            new GetObjectCommand({ Bucket: bucket, Key: key }),
            { expiresIn: SIGNED_URL_SECONDS },
          );
          return { key, url };
        }),
      );
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({ objects: signed });
    }

    if (req.method === "DELETE" && action === "delete") {
      if (!Array.isArray(body.keys) || body.keys.length > MAX_OBJECTS) {
        return res.status(400).json({ error: "Invalid object list" });
      }
      const keys = body.keys.filter(
        (key) => typeof key === "string" && key.startsWith(prefix) && validObjectName(key),
      );
      if (keys.length !== body.keys.length) {
        return res.status(403).json({ error: "Object does not belong to this account" });
      }
      if (keys.length > 0) {
        await client.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
          }),
        );
      }
      return res.status(200).json({ deleted: keys.length });
    }

    return res.status(400).json({ error: "Unsupported action" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "R2 request failed";
    if (message.startsWith("Missing ")) {
      return res.status(503).json({ error: "Cloud storage is not configured" });
    }
    console.error("R2 request failed", error);
    return res.status(500).json({ error: "Cloud storage request failed" });
  }
}
