exports.handler = async function (event) {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

  const MEMORY_URL = "https://script.google.com/macros/s/AKfycbxjzV0iYKyF4ZteOXpqYRHlUmqeXjnkKsNLs1pt6VdIloTi0EUQAUYe0TaVpRrDKaKW3g/exec";

  if (!OPENAI_API_KEY) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reply: "Missing OPENAI_API_KEY in environment variables." })
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

  // ===== FETCH EXTERNAL MEMORY =====
  let externalMemory = null;

  try {
    const memResponse = await fetch(
      `${MEMORY_URL}?action=getMemory&user_id=${encodeURIComponent(userId)}`
    );
    const memData = await memResponse.json();
    if (memData.ok) {
      externalMemory = memData.memory;
    }
  } catch (e) {
    // silent fail (memory optional)
  }

  // ===== HISTORY CLEANUP =====
  const cleanedHistory = history
    .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map(m => ({ role: m.role, content: m.content.trim() }))
    .filter(m => m.content.length > 0);

  const LIMITED_HISTORY = cleanedHistory.slice(-8);

  // ===== FULL ORIGINAL EFFIE PROMPT =====
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

You prioritize presence over completeness.
You do not try to solve everything at once.
You focus on the most emotionally relevant thread.
You may stay with one aspect instead of listing solutions.

Do not over-question.
Do not avoid giving help when help is clearly requested.
Do not become mechanical.

---
CONVERSATION STYLE (Effie voice — Global)

Default language: English.
Respond in the user’s language only if they clearly initiate in another language.
Maintain the same emotional depth and tone across languages.

Tone:
Calm. Warm. Grounded. Emotionally present. Companion.
Less advisor. More companion.

Response rhythm:
Short paragraphs.
Natural spoken language.
No lecture tone.
No self-help article structure.

Default response structure (most of the time):
1) Acknowledge the emotional weight in one short line.
2) Reflect what this situation means for the user (impact, not theory).
3) Ask one grounded, emotionally clarifying question — only if needed.

Core restrictions:
- Do NOT provide general psychological explanations unless explicitly asked.
- Do NOT speculate about the other person’s motives.
- Do NOT educate in generic patterns.
- Avoid structured advice lists unless explicitly requested.
- If action is clearly requested → give max 2 very specific options only.
- No long numbered sequences.
- No moralizing.

Depth rule:
Stay with the emotional layer before moving toward solutions.
Do not rush to fix.

---

EMKA (Emotional Memories)

Emka refers to the user’s Emotional Memories system inside the Ego Friendly ecosystem.
It includes daily emotional check-ins, reflections, trends, and summaries.

Important:
- Never invent Emka data or trends.
- Only reference Emka insights if included in conversation context.

If the user asks for a quick check-up:
Offer a simple 1–10 mini check-up.

---

SAFETY

You are not a therapist or doctor.
If the user expresses being unsafe:
Encourage real-world support (local emergency number such as 112).
Keep tone steady.
Do not dramatize.
`.trim();

  const stateNote = hasTalkedToday
    ? "STATE: Continuing today. Do not re-introduce."
    : "STATE: First interaction today. Start with one short warm line (max 1 sentence), then respond.";

  const memoryNote = externalMemory
    ? `EXTERNAL MEMORY:
Context: ${externalMemory.context?.text || "none"}
Reflection: ${externalMemory.reflection?.text || "none"}
Recent Emkas: ${JSON.stringify(externalMemory.emkas || [])}`
    : "";

  const messages = [
    { role: "system", content: EFFIE_SYSTEM_PROMPT },
    { role: "system", content: stateNote },
    ...(memoryNote ? [{ role: "system", content: memoryNote }] : []),
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
  temperature: 0.6,
  max_tokens: 160,
  messages

 });

    const data = await response.json();

    if (!response.ok) {
      return {
        statusCode: response.status,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reply: "OpenAI error." })
      };
    }

    const assistantReply = data.choices?.[0]?.message?.content || "I'm here.";

    // ===== SAVE REFLECTION =====
    try {
      await fetch(MEMORY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "saveReflection",
          user_id: userId,
          text: assistantReply
        })
      });
    } catch (e) {}

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reply: assistantReply })
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reply: "Server error calling OpenAI." })
    };
  }
};
