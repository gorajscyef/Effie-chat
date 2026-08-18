// netlify/functions/realtime-session.js
// Effie 2.0 — isolated Talk to Effie / Realtime layer.
// IMPORTANT: This file does not modify effie.js, Emka, or existing memory logic.

exports.handler = async function (event) {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  const REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-2.1";

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

  try {
    const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session: {
          type: "realtime",
          model: REALTIME_MODEL,
          instructions: [
            "You are Effie — the Ego Friendly Companion.",
            "You are not a productivity tool and you are not a therapist.",
            "Be warm, grounded, calm and human.",
            "Reply in the user's language unless they ask for another language.",
            "Keep spoken responses concise and natural by default.",
            "Do not lecture or over-explain.",
            "Do not diagnose or present yourself as a mental-health professional.",
            "No judgement. No pressure. Listen first.",
            "This Realtime layer is voice-only for now; do not run Emka or memory workflows yet."
          ].join("\n"),
          audio: {
            input: {
              turn_detection: {
                type: "server_vad"
              }
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
        details: data,
      });
    }

    // Return only the temporary client secret/session payload from OpenAI.
    // The permanent OPENAI_API_KEY never leaves Netlify.
    return json(200, data);
  } catch (err) {
    console.error("Realtime session function crash:", err);
    return json(500, { error: "Realtime session server error" });
  }
};
