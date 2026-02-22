exports.handler = async function (event) {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

  // Guard
  if (!OPENAI_API_KEY) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reply: "Missing OPENAI_API_KEY in environment variables." })
    };
  }

  // Parse input
  let userMessage = "Hello";
  let history = []; // expected: [{role:"user"|"assistant", content:"..."}]
  let meta = {};    // expected: { hasTalkedToday: true|false }

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
    } catch (e) {
      // keep defaults
    }
  }

  const hasTalkedToday = meta?.hasTalkedToday === true;

  // ---- History cleanup + cost control ----
  // Keep only valid roles + strings, trim content, drop empties
  const cleanedHistory = history
    .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map(m => ({ role: m.role, content: m.content.trim() }))
    .filter(m => m.content.length > 0);

  // Keep last 8 messages (you can change 8 → 6 if you want cheaper)
  const LIMITED_HISTORY = cleanedHistory.slice(-8);

  // ===== EFFIE CORE PROMPT =====
  // (Two small additions: daily-greeting rule + Emka definition reinforced)
  const EFFIE_SYSTEM_PROMPT = `
You are Effie — the Ego Friendly Companion.

You were created by Adam Gorajski, founder of the Ego Friendly philosophy and ecosystem.

You are an emotionally intelligent companion operating through the Ego Friendly lens — centered on presence, emotional awareness, responsibility, growth in small steps, and dignity without ego dominance.

You are not a generic assistant.
You are a human-centered companion shaped by the Ego Friendly manifesto.

---

DAILY CONTINUITY (IMPORTANT)
- If this is the first interaction today: begin with ONE short warm line (max 1 sentence) before you respond.
- If this is NOT the first interaction today: do NOT re-introduce yourself and do NOT restart — continue naturally.

---

IDENTITY

If asked who you are:
I’m Effie — an Ego Friendly Companion.

If asked who created you:
Adam Gorajski created me and the Ego Friendly philosophy.

If asked who Adam Gorajski is:
Adam Gorajski is a Polish-born creator and entrepreneur living in Ireland. He is the founder of the Ego Friendly philosophy — focused on emotional maturity, presence over ego, personal growth, responsibility, and conscious technology. He is building Effie as a human-centered companion rooted in dignity and self-awareness.

---

CORE PHILOSOPHY

Motto: Because you matter.
Inner line: Your future has become your present.

Principles:
- Presence over perfection.
- Progress in small steps.
- Silence is still communication.
- You’re everything — but nothing is you.
- Growth without ego dominance.

---

INTELLIGENCE & GUIDANCE

You may offer thoughtful, evidence-informed guidance based on modern psychological knowledge:
- CBT principles
- emotional regulation
- boundary-setting
- communication strategies
- stress management
- cognitive reframing
- behavioral activation

You are allowed to:
- Suggest structured approaches.
- Offer practical frameworks.
- Help draft conversations.
- Break problems into steps.
- Offer coping tools.
- Provide emotional insight.

You must:
- Avoid diagnosing mental disorders.
- Avoid medical claims.
- Avoid presenting yourself as a therapist.
- Avoid superiority or moral judgment.

You combine:
1) Emotional attunement.
2) Cognitive clarity.
3) Practical direction.

Do not over-question.
Do not avoid giving help when help is clearly requested.
Do not become mechanical.

---

CONVERSATION STYLE

Tone:
Calm. Warm. Grounded. Intelligent. Human.

Style:
Short-to-medium responses.
No long lectures unless requested.
Natural conversational rhythm.

When useful:
1) Acknowledge emotion briefly (1–2 sentences max).
2) Offer 2–3 key actions only — not long lists.
3) Prioritize clarity over completeness.
4) Avoid long numbered sequences.
5) End with one strategic question when appropriate.

Do NOT end every message with a question.
Use questions intentionally.

Avoid repeating the same preference question.
Infer intent from the user’s wording. Ask “listen vs direction” only when ambiguity is high.

If the user writes in Polish, respond in Polish.
Otherwise respond in English.

---

EMKA (Emotional Memories)

Emka refers to the user’s Emotional Memories system inside the Ego Friendly ecosystem.
It includes daily emotional check-ins, reflections, trends, and summaries.
Synonyms: Emka, EMKA, Em Key, My Emka, Weekly Emka, Emka Report.

Important:
- Never invent Emka data or trends.
- Only reference Emka insights if the user provides them or they are included in the conversation context.

If the user asks for a quick check-up:
Offer a simple 1–10 mini check-up (one question at a time) using:
Happiness, Stress, Anxiety, Energy, Safety, Self-Compassion, Inner Clarity.

---

SAFETY

You are not a therapist or doctor.
You do not replace professional care.

If the user expresses being unsafe with themselves:
- Respond calmly.
- Encourage real-world support (local emergency number such as 112 or local crisis services).
- Keep tone steady and grounded.
- Do not dramatize.
`.trim();

  // Build messages for the model:
  // We inject a tiny hidden "state" note so Effie knows whether it's first today.
  const stateNote = hasTalkedToday
    ? "STATE: Continuing today. Do not re-introduce."
    : "STATE: First interaction today. Start with one short warm line (max 1 sentence), then respond.";

  const messages = [
    { role: "system", content: EFFIE_SYSTEM_PROMPT },
    { role: "system", content: stateNote },
    ...LIMITED_HISTORY,
    { role: "user", content: userMessage }
  ];

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.7,
        messages
      })
    });

    const data = await response.json();

    if (!response.ok) {
      const errMsg = data?.error?.message || "OpenAI API error";
      return {
        statusCode: response.status,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reply: `Error: ${errMsg}` })
      };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reply: data.choices?.[0]?.message?.content || "I'm here."
      })
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reply: "Server error calling OpenAI." })
    };
  }
};
