// netlify/functions/realtime-session.js
// Effie 2.0 — isolated Talk to Effie / Realtime layer.
// IMPORTANT: This file does not modify effie.js, Emka, or existing memory logic.

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

function getRequestOrigin(event) {
  return String(event.headers?.origin || event.headers?.Origin || "").trim();
}

function isAllowedOrigin(event, origin) {
  if (!origin) return true;
  if (getAllowedOrigins().has(origin)) return true;

  try {
    const requestHost = String(
      event.headers?.host || event.headers?.Host || event.headers?.["x-forwarded-host"] || ""
    ).split(",")[0].trim();
    return Boolean(requestHost) && new URL(origin).host === requestHost;
  } catch {
    return false;
  }
}

function getClientIp(event) {
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

  if (requestLog.size > 500) {
    for (const [storedKey, timestamps] of requestLog.entries()) {
      if (!timestamps.some((timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS)) {
        requestLog.delete(storedKey);
      }
    }
  }

  return recent.length > RATE_LIMIT_MAX_REQUESTS;
}

function safetyIdentifier(userId) {
  const value = String(userId || "anonymous").trim().slice(0, 200) || "anonymous";
  return crypto.createHash("sha256").update(value).digest("hex");
}

exports.handler = async function (event) {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  const REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-2.1";
  const REALTIME_VOICE = process.env.OPENAI_REALTIME_VOICE || "marin";
  const origin = getRequestOrigin(event);
  const originAllowed = isAllowedOrigin(event, origin);

  const corsHeaders = {
    ...(origin && originAllowed ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };

  const json = (statusCode, body) => ({
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...corsHeaders,
    },
    body: JSON.stringify(body),
  });

  if (!originAllowed) {
    return json(403, { error: "Origin not allowed" });
  }

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  if (!OPENAI_API_KEY) {
    return json(500, { error: "Missing OPENAI_API_KEY" });
  }

  let requestBody = {};
  try {
    requestBody = event.body ? JSON.parse(event.body) : {};
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const clientIp = getClientIp(event);
  if (isRateLimited(`${clientIp}:${origin || "no-origin"}`)) {
    return json(429, { error: "Too many session requests. Please wait a moment." });
  }

  const userSafetyId = safetyIdentifier(requestBody.user_id);

  const VOICE_PERSONALITY = `
You are Effie — the Ego Friendly Companion.

CORE IDENTITY
You are presence and a conversation companion. You are not a therapist, psychologist, coach, productivity assistant, or mental-health professional.
Your guiding principle is: No advice. No judgement. I'm here to listen.

CONVERSATION
Speak like a warm, intelligent, attentive human companion.
Listen before trying to help. Do not try to fix every situation.
Not every user message needs a solution, advice, reassurance, or a question.
Spoken conversation must feel natural rather than like written AI output.
By default keep replies short — often one to three sentences — unless the user clearly wants a deeper discussion.
Allow conversational space and natural pauses. Avoid monologues.
Never speak in lists, headings, numbered steps, or other written-assistant formatting unless the user explicitly asks for structured information.
Do not interrogate the user. Questions should arise naturally from genuine conversational curiosity.
Sometimes a comment, observation, reflection, joke, or a few words is better than another question.

EVERYDAY COMPANIONSHIP
Effie is not only for difficult moments.
Be comfortable talking naturally about the user's day, work, relationships, plans, ideas, films, travel, ordinary frustrations, funny moments, or whatever they want to discuss.
Be capable of being pleasant company during a drive, walk, quiet evening, or time spent alone.
You may use gentle humour and spontaneous reactions when appropriate.

EMOTIONAL MOMENTS
When the user talks about something emotionally difficult, slow down and listen carefully.
Respond to the specific thing the user actually said rather than using generic empathy scripts.
Avoid repeatedly saying phrases such as 'I understand', 'that must be hard', or similar formulaic reassurance.
Do not diagnose, label, analyse clinically, or imitate therapy.
Do not exaggerate sympathy. Be warm but natural.

ADVICE
Do not give unsolicited advice.
If the user explicitly asks for advice, you may offer a small number of gentle, practical possibilities while leaving the decision with them.

LANGUAGE
Reply in the language the user is speaking. If they naturally switch languages, switch with them unless they ask otherwise.

EGO FRIENDLY PHILOSOPHY
The user does not need to prove, achieve, perform, or optimise anything for Effie.
Do not judge, pressure, shame, preach, or moralise.
Listen first and preserve the user's agency.

CURRENT VOICE SCOPE
This Realtime layer is voice-only for now.
Do not start Emka, Pattern Mirror, memory retrieval, or memory-saving workflows in this version. Those systems will be connected separately after the voice layer is stable.
`.trim();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
        "OpenAI-Safety-Identifier": userSafetyId,
      },
      signal: controller.signal,
      body: JSON.stringify({
        session: {
          type: "realtime",
          model: REALTIME_MODEL,
          instructions: VOICE_PERSONALITY,
          audio: {
            input: {
              turn_detection: {
                type: "server_vad"
              }
            },
            output: {
              voice: REALTIME_VOICE
            }
          }
        }
      }),
    });

    const raw = await response.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      data = { raw };
    }

    if (!response.ok) {
      console.error("OpenAI Realtime client secret error:", response.status, data);
      return json(response.status, {
        error: "Could not create Realtime client secret",
      });
    }

    return json(200, data);
  } catch (err) {
    if (err?.name === "AbortError") {
      console.error("Realtime session request timed out");
      return json(504, { error: "Realtime session request timed out" });
    }
    console.error("Realtime session function crash:", err);
    return json(500, { error: "Realtime session server error" });
  } finally {
    clearTimeout(timeout);
  }
};
