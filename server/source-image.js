import { createHash } from "node:crypto";

export const MAX_SOURCE_IMAGE_BYTES = 64 * 1024 * 1024;
export const MAX_BROWSER_FALLBACK_BYTES = 3 * 1024 * 1024;
const MAX_REDIRECTS = 4;
const ALLOWED_SOURCE_HOSTS = new Set([
  "commons.wikimedia.org",
  "upload.wikimedia.org",
]);

export function allowedSourceUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value ?? ""));
  } catch {
    throw new Error("The candidate needs a valid direct image URL.");
  }
  if (parsed.protocol !== "https:") throw new Error("Source images must use HTTPS.");
  if (parsed.username || parsed.password || parsed.port) {
    throw new Error("The source image URL contains unsupported connection details.");
  }
  if (!ALLOWED_SOURCE_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error("Automatic preparation currently supports Wikimedia Commons images only.");
  }
  return parsed;
}

export async function fetchAllowedSourceImage(value, fetcher = fetch) {
  let current = allowedSourceUrl(value);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const response = await fetcher(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
      headers: {
        accept: "image/jpeg,image/png,image/webp",
        "user-agent": "PinpointRadiology/1.0 (open medical-image preparation)",
      },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("The source image redirect was incomplete.");
      current = allowedSourceUrl(new URL(location, current).toString());
      continue;
    }
    if (!response.ok) throw new Error(`The source image could not be downloaded (${response.status}).`);
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_SOURCE_IMAGE_BYTES) throw new Error("The source image exceeds the 64 MB limit.");
    return { response, finalUrl: current.toString() };
  }
  throw new Error("The source image redirected too many times.");
}

export async function readLimitedBody(response, limit = MAX_SOURCE_IMAGE_BYTES) {
  if (!response.body) throw new Error("The source image response was empty.");
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new Error("The source image exceeds the 64 MB limit.");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  if (!total) throw new Error("The source image response was empty.");
  return Buffer.concat(chunks, total);
}

export function decodeBrowserSourceImage(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error("The browser fallback image was invalid.");
  }
  const estimatedBytes = Math.floor((value.length * 3) / 4);
  if (estimatedBytes > MAX_BROWSER_FALLBACK_BYTES) {
    throw new Error("The browser fallback image exceeds the 3 MB limit.");
  }
  const bytes = Buffer.from(value, "base64");
  if (!bytes.length || bytes.length > MAX_BROWSER_FALLBACK_BYTES) {
    throw new Error("The browser fallback image was empty or too large.");
  }
  return bytes;
}

function pngDetails(bytes) {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return null;
  return { mimeType: "image/png", extension: "png", width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function jpegDetails(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    const marker = bytes[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (marker === 0xda) break;
    if (offset + 2 > bytes.length) break;
    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) break;
    if (startOfFrame.has(marker)) {
      return {
        mimeType: "image/jpeg",
        extension: "jpg",
        width: bytes.readUInt16BE(offset + 5),
        height: bytes.readUInt16BE(offset + 3),
      };
    }
    offset += segmentLength;
  }
  throw new Error("The JPEG dimensions could not be read.");
}

function webpDetails(bytes) {
  if (bytes.length < 30 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP") return null;
  const format = bytes.toString("ascii", 12, 16);
  if (format === "VP8X") {
    const width = 1 + bytes.readUIntLE(24, 3);
    const height = 1 + bytes.readUIntLE(27, 3);
    return { mimeType: "image/webp", extension: "webp", width, height };
  }
  if (format === "VP8L" && bytes[20] === 0x2f) {
    const width = 1 + (bytes[21] | ((bytes[22] & 0x3f) << 8));
    const height = 1 + ((bytes[22] >> 6) | (bytes[23] << 2) | ((bytes[24] & 0x0f) << 10));
    return { mimeType: "image/webp", extension: "webp", width, height };
  }
  if (format === "VP8 ") {
    for (let offset = 20; offset + 9 < bytes.length; offset += 1) {
      if (bytes[offset] === 0x9d && bytes[offset + 1] === 0x01 && bytes[offset + 2] === 0x2a) {
        return {
          mimeType: "image/webp",
          extension: "webp",
          width: bytes.readUInt16LE(offset + 3) & 0x3fff,
          height: bytes.readUInt16LE(offset + 5) & 0x3fff,
        };
      }
    }
  }
  throw new Error("The WebP dimensions could not be read.");
}

export function inspectSourceImage(input) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const details = pngDetails(bytes) ?? jpegDetails(bytes) ?? webpDetails(bytes);
  if (!details || details.width < 1 || details.height < 1) {
    throw new Error("The downloaded file is not a supported PNG, JPEG or WebP image.");
  }
  return details;
}

export function sourceImageQa(bytes, details, modality, now = new Date()) {
  const warnings = [];
  const minimum = Math.min(details.width, details.height);
  if (minimum < 512) warnings.push("The image is below 512 pixels on its shortest side.");
  else if (modality === "X-ray" && minimum < 1000) warnings.push("This radiograph may look soft on large displays.");
  const fileHash = createHash("sha256").update(bytes).digest("hex");
  const fingerprint = createHash("sha256").update(fileHash).digest("hex");
  return {
    status: warnings.length ? "warning" : "pass",
    checkedAt: now.toISOString(),
    fileCount: 1,
    totalBytes: bytes.length,
    minWidth: details.width,
    minHeight: details.height,
    fingerprint,
    warnings,
    errors: [],
  };
}
