// netlify/functions/identity-create.js
// Creates an opaque Effie Memory ID that can be stored on an Adalo user record.

const crypto = require("crypto");

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 10;
const requestLog = new Map();

function getAllowedOrigins() {
  const configured = String(process.env.EFFIE_ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return new Set([
    "https://ef-egofriendly.com",
    "https://www.ef-egofriendly.com",
    ...configured,
  ]);
}

function requestOrigin(event) {
  return String(event.headers?.origin || event.headers?.Origin || "").trim();
}

function isAllowedOrigin(event, origin) {
  if (!origin || getAllowedOrigins().has(origin)) return true;

  try {
    const host = String(
      event.headers?.host || event.headers?.Host || event.headers?.["x-forwarded-host"] || ""
    ).split(",")[0].trim();
    return Boolean(host) && new URL(origin).host === host;
  } catch {
    return false;
  }
}

function clientIp(event) {
  return String(
    event.headers?.["x-nf-client-connection-ip"] ||
    event.headers?.["client-ip"] ||
    event.headers?.["x-forwarded-for"] ||
    "unknown"
  ).split(",")[0].trim();
}

function isRateLimited(key) {
  const now = Date.now();
  const recent = (requestLog.get(key) || []).filter(
    (timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS
  );
  recent.push(now);
  requestLog.set(key, recent);
  return recent.length > RATE_LIMIT_MAX_REQUESTS;
}

exports.handler = async function (event) {
  const origin = requestOrigin(event);
  const allowed = isAllowedOrigin(event, origin);
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    ...(origin && allowed ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
  const json = (statusCode, body) => ({
    statusCode,
    headers,
    body: JSON.stringify(body),
  });

  if (!allowed) return json(403, { error: "Origin not allowed" });
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  if (isRateLimited(`${clientIp(event)}:${origin || "no-origin"}`)) {
    return json(429, { error: "Too many identity requests. Please wait a moment." });
  }

  return json(200, {
    effie_memory_id: `ef_account_${crypto.randomBytes(32).toString("base64url")}`,
  });
};
