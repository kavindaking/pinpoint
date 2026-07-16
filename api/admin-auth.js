import {
  adminConfigured,
  clearSessionCookie,
  createAdminToken,
  hasSameOrigin,
  isAdminRequest,
  passwordMatches,
  sessionCookie,
} from "../server/admin-auth.js";

const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 8;

function bodyOf(req) {
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body ?? {};
}

function clientKey(req) {
  return String(req.headers["x-forwarded-for"] ?? req.socket?.remoteAddress ?? "unknown").split(",")[0];
}

export default async function handler(req, res) {
  res.setHeader("cache-control", "no-store");

  if (!adminConfigured()) {
    res.status(503).json({ authenticated: false, error: "Admin access is not configured." });
    return;
  }

  if (req.method === "GET") {
    res.status(200).json({ authenticated: isAdminRequest(req) });
    return;
  }

  if (!hasSameOrigin(req)) {
    res.status(403).json({ authenticated: false, error: "Invalid request origin." });
    return;
  }

  if (req.method === "DELETE") {
    res.setHeader("set-cookie", clearSessionCookie());
    res.status(200).json({ authenticated: false });
    return;
  }

  if (req.method !== "POST") {
    res.setHeader("allow", "GET, POST, DELETE");
    res.status(405).json({ authenticated: false, error: "Method not allowed." });
    return;
  }

  const key = clientKey(req);
  const now = Date.now();
  const record = attempts.get(key);
  const recent = record && now - record.startedAt < WINDOW_MS ? record : { failures: 0, startedAt: now };
  if (recent.failures >= MAX_FAILURES) {
    res.status(429).json({ authenticated: false, error: "Too many login attempts. Try again later." });
    return;
  }

  if (!passwordMatches(bodyOf(req).password)) {
    attempts.set(key, { ...recent, failures: recent.failures + 1 });
    res.status(401).json({ authenticated: false, error: "Incorrect password." });
    return;
  }

  attempts.delete(key);
  res.setHeader("set-cookie", sessionCookie(createAdminToken()));
  res.status(200).json({ authenticated: true });
}
