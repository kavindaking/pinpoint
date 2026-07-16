import { createHmac, createHash, timingSafeEqual } from "node:crypto";

export const ADMIN_COOKIE = "pinpoint_admin";
const SESSION_SECONDS = 12 * 60 * 60;

function secret() {
  return process.env.ADMIN_SESSION_SECRET ?? "";
}

function sign(value) {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

export function adminConfigured() {
  return Boolean(process.env.ADMIN_PASSWORD && secret());
}

export function passwordMatches(candidate) {
  if (!adminConfigured() || typeof candidate !== "string") return false;
  const actual = createHash("sha256").update(candidate).digest();
  const expected = createHash("sha256").update(process.env.ADMIN_PASSWORD).digest();
  return timingSafeEqual(actual, expected);
}

export function createAdminToken() {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const payload = Buffer.from(JSON.stringify({ expiresAt })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function cookieValue(req, name) {
  const cookies = String(req.headers.cookie ?? "").split(";");
  for (const cookie of cookies) {
    const [key, ...parts] = cookie.trim().split("=");
    if (key === name) return decodeURIComponent(parts.join("="));
  }
  return "";
}

export function isAdminRequest(req) {
  if (!adminConfigured()) return false;
  const token = cookieValue(req, ADMIN_COOKIE);
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  const expected = sign(payload);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
    return false;
  }
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return Number(parsed.expiresAt) > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export function sessionCookie(token) {
  const secure = process.env.VERCEL || process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${ADMIN_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_SECONDS}${secure}`;
}

export function clearSessionCookie() {
  const secure = process.env.VERCEL || process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${ADMIN_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}

export function hasSameOrigin(req) {
  const origin = String(req.headers.origin ?? "");
  const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
