import { createClient } from "@supabase/supabase-js";

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TURNSTILE_ACTION = "sign_in";
const MAX_EMAIL_LENGTH = 254;

function parseBody(req) {
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body ?? {};
}

function allowedHostnames() {
  return new Set(
    (process.env.TURNSTILE_ALLOWED_HOSTNAMES ?? "pinpoint-jade.vercel.app,localhost")
      .split(",")
      .map((hostname) => hostname.trim().toLowerCase())
      .filter(Boolean),
  );
}

function requestDetails(req) {
  const origin = String(req.headers.origin ?? "");
  try {
    const url = new URL(origin);
    return { hostname: url.hostname.toLowerCase(), origin: `${url.protocol}//${url.host}` };
  } catch {
    return { hostname: "", origin: "" };
  }
}

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] ?? req.socket?.remoteAddress ?? "")
    .split(",")[0]
    .trim();
}

function validEmail(value) {
  return (
    typeof value === "string" &&
    value.length <= MAX_EMAIL_LENGTH &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  );
}

async function verifyTurnstile({ token, ip, hostname }) {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) throw new Error("Turnstile server configuration is missing");
  if (typeof token !== "string" || token.length < 10 || token.length > 2048) return false;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, response: token, remoteip: ip || undefined }),
      signal: controller.signal,
    });
    if (!response.ok) return false;
    const result = await response.json();
    return (
      result.success === true &&
      result.action === TURNSTILE_ACTION &&
      String(result.hostname ?? "").toLowerCase() === hostname
    );
  } finally {
    clearTimeout(timeout);
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { hostname, origin } = requestDetails(req);
  if (!hostname || !allowedHostnames().has(hostname)) {
    return res.status(403).json({ error: "Invalid request origin" });
  }

  const body = parseBody(req);
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!validEmail(email)) return res.status(400).json({ error: "Enter a valid email address" });

  try {
    const verified = await verifyTurnstile({
      token: body.turnstileToken,
      ip: clientIp(req),
      hostname,
    });
    if (!verified) {
      return res.status(403).json({ error: "Security verification failed. Please try again." });
    }

    const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
    const key =
      process.env.SUPABASE_PUBLISHABLE_KEY ??
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
      process.env.VITE_SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error("Supabase server configuration is missing");

    const supabase = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${origin}/`, shouldCreateUser: true },
    });
    if (error) {
      console.error("Supabase OTP request failed", error.message);
      return res.status(error.status === 429 ? 429 : 400).json({
        error:
          error.status === 429
            ? "Too many sign-in emails requested. Please wait and try again."
            : "Unable to send the sign-in email. Please try again.",
      });
    }

    return res.status(200).json({ sent: true });
  } catch (error) {
    console.error("Protected sign-in request failed", error);
    return res.status(503).json({ error: "Sign-in service is temporarily unavailable." });
  }
}
