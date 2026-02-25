// netlify/functions/effie.js

exports.handler = async function (event) {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

  const MEMORY_URL =
    "https://script.google.com/macros/s/AKfycbxjzV0iYKyF4ZteOXpqYRHlUmqeXjnkKsNLs1pt6VdIloTi0EUQAUYe0TaVpRrDKaKW3g/exec";

  if (!OPENAI_API_KEY) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reply: "Missing OPENAI_API_KEY." }),
    };
  }

  // ===== PARSE INPUT =====
  let userMessage = "Hello";
  let history = [];
  let meta = {};

  if (event.body) {
    try {
      const parsed = JSON.parse(event.body);

      if (typeof parsed.message === "string" && parsed.message.trim().length) {
        userMessage = parsed.message.trim();
      }

      if (Array.isArray(parsed.history)) {
        history = parsed.history;
      }

      if (parsed.meta && typeof parsed.meta === "object") {
        meta = parsed.meta;
      }
    } catch (e) {}
  }

  const hasTalkedToday = meta?.hasTalkedToday === true;
  const userId = meta?.user_id || "default_user";

  // ===== FETCH MEMORY =====
  let externalMemory = null;

  try {
    const memResponse = await fetch(
      `${MEMORY_URL}?action=getMemory&user_id=${encodeURIComponent(userId)}`
    );
    const memData = await memResponse.json();
    if (memData && memData.ok) {
      externalMemory = memData.memory;
    }
  } catch (e) {}

  // ===== CLEAN HISTORY =====
  const cleanedHistory = history
    .filter(
      (m) =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string"
    )
    .map((m) => ({ role: m.role, content: m.content.trim() }))
    .filter((m) => m.content.length > 0);

  const LIMITED_HISTORY = cleanedHistory.slice(-6);

  // ===== MODE DETECTION =====
  const lowerMsg = userMessage.toLowerCase();

  const isCheckUp =
    lowerMsg.includes("check up") ||
    lowerMsg.includes("check-up") ||
    lowerMsg.includes("emka check") ||
    lowerMsg.includes("full check");

  // ===== CORE PRESENCE PROMPT =====
  const BASE_PROMPT = `
You are Effie — an Ego Friendly Companion.

You are not a productivity tool.
You are not a therapist.
You are presence.

Core energy:
Calm. Grounded. Human.
Because the user matters.

RESPONSE STYLE:
- Stay with the emotional weight before offering solutions.
- Fewer words. More presence.
- Short paragraphs.
- Max 6 sentences.
- Prefer depth over explanation.
- Silence is allowed.
- Not every message needs a question.

DO NOT:
- Diagnose.
- Over-explain psychology.
- Sound like a self-help article.
- Try to impress with intelligence.
- Rush to fix everything.

If advice is clearly requested:
Offer max 2 gentle, specific options.
Keep tone soft and grounded.
`.trim();

  // ===== CHECK-UP MODE =====
  const CHECKUP_PROMPT = `
CHECK-UP MODE.

Ask these 7 questions one by one:

1) Happiness (1–10)
2) Stress (1–10)
3) Anxiety (1–10)
4) Energy (1–10)
5) Safety (1–10)
6) Self-Compassion (1–10)
7) Inner Clarity (1–10)

Rules:
- Ask sequentially.
- Wait for answers.
- After all answers → give short emotional reflection (max 5 sentences).
- No therapy tone.
- No diagnosis.
- Stay calm and human.
`.trim();

  const DAILY_NOTE = hasTalkedToday
    ? "Continue naturally."
    : "First interaction today. Begin with one short warm line.";

  const MEMORY_NOTE = externalMemory
    ? "External emotional context exists. Use gently only if relevant."
    : "";

  const systemMessages = [
    { role: "system", content: BASE_PROMPT },
    { role: "system", content: DAILY_NOTE },
    ...(MEMORY_NOTE ? [{ role: "system", content: MEMORY_NOTE }] : []),
  ];

  if (isCheckUp) {
    systemMessages.push({ role: "system", content: CHECKUP_PROMPT });
  }

  const messages = [
    ...systemMessages,
    ...LIMITED_HISTORY,
    { role: "user", content: userMessage },
  ];

  // ===== OPENAI CALL =====
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.55,
        max_tokens: 130,
        presence_penalty: 0.3,
        frequency_penalty: 0.2,
        messages,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("OpenAI error:", response.status, data);
      return {
        statusCode: response.status,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reply: "OpenAI error." }),
      };
    }

    const assistantReply =
      data?.choices?.[0]?.message?.content?.trim() || "I'm here.";

    if (!isCheckUp) {
      try {
        await fetch(MEMORY_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "saveReflection",
            user_id: userId,
            text: assistantReply,
          }),
        });
      } catch (e) {}
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reply: assistantReply }),
    };
  } catch (err) {
    console.error("Function crash:", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reply: "Server error." }),
    };
  }
};
