// netlify/functions/realtime-session.js
// Effie 2.0 — isolated Talk to Effie / Realtime layer.
// IMPORTANT: This file does not modify effie.js, Emka, or existing memory logic.
//
// Phase 1 scaffold only. We intentionally do not create a Realtime session yet.
// The next step is to add the server-side OpenAI Realtime session/client-secret
// request here, using the existing OPENAI_API_KEY stored in Netlify.

exports.handler = async function (event) {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

  const json = (statusCode, body) => ({
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(body),
  });

  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  if (!OPENAI_API_KEY) {
    return json(500, { error: "Missing OPENAI_API_KEY" });
  }

  return json(501, {
    ready: false,
    message: "Effie Realtime endpoint scaffold is installed. Session creation is not enabled yet.",
  });
};
