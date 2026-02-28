// netlify/functions/effie.js
// Effie v2.4 — Emka NOT mandatory (only gates Q8 + Pattern + Daily Reflection)
// Q8 only after Emka + after a few lines of exchange + max once/day
// Pattern threshold: 4 occurrences / 14 days (4/14)
// Manifest link only when explicitly asked

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
    } catch (e) {
      // ignore parse errors
    }
  }

  const hasTalkedToday = meta?.hasTalkedToday === true;
  const userId = meta?.user_id || "default_user";

  // Date key (prefer client-provided date)
  const todayKey =
    typeof meta?.today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(meta.today)
      ? meta.today
      : new Date().toISOString().slice(0, 10);

  // ===== FETCH EXTERNAL MEMORY (optional) =====
  let externalMemory = null;
  try {
    const memResponse = await fetch(
      `${MEMORY_URL}?action=getMemory&user_id=${encodeURIComponent(userId)}`
    );
    const memData = await memResponse.json();
    if (memData && memData.ok) externalMemory = memData.memory;
  } catch (e) {
    // silent fail
  }

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

  // Keep fewer turns for speed + cost control
  const LIMITED_HISTORY = cleanedHistory.slice(-6);

  // ===== LIGHT MODE DETECTION =====
  const lowerMsg = userMessage.toLowerCase();

  // User explicitly requests check-up / Emka
  const isCheckUpRequest =
    lowerMsg.includes("check up") ||
    lowerMsg.includes("check-up") ||
    lowerMsg.includes("checkup") ||
    lowerMsg.includes("emka") && (lowerMsg.includes("check") || lowerMsg.includes("do") || lowerMsg.includes("start")) ||
    lowerMsg.includes("daily check") ||
    lowerMsg.includes("quick check");

  const asksAboutIdentityOrDifference =
    lowerMsg.includes("who are you") ||
    lowerMsg.includes("who created") ||
    lowerMsg.includes("manifest") ||
    lowerMsg.includes("what makes you different") ||
    lowerMsg.includes("different from gpt") ||
    lowerMsg.includes("different from chatgpt") ||
    lowerMsg.includes("how are you different") ||
    lowerMsg.includes("what is your identity") ||
    lowerMsg.includes("what are you built on") ||
    lowerMsg.includes("what is your philosophy") ||
    lowerMsg.includes("ego friendly");

  // "Misuse" intentions (soft guard)
  const looksPolitical =
    lowerMsg.includes("election") ||
    lowerMsg.includes("president") ||
    lowerMsg.includes("government") ||
    lowerMsg.includes("politics") ||
    lowerMsg.includes("party") ||
    lowerMsg.includes("vote");

  const looksLikeImageRequest =
    lowerMsg.includes("generate image") ||
    lowerMsg.includes("make a graphic") ||
    lowerMsg.includes("create a logo") ||
    lowerMsg.includes("image prompt") ||
    lowerMsg.includes("cover art");

  // ===== EMKA DONE TODAY? (best-effort) =====
  const emkaDate =
    externalMemory?.emka_today?.date ||
    externalMemory?.emka?.date ||
    externalMemory?.last_emka_date ||
    null;

  const hasEmkaToday = emkaDate === todayKey || meta?.hasEmkaToday === true;

  // ===== THEMES (8) =====
  function classifyTheme(text) {
    const t = (text || "").toLowerCase();

    // Relationship
    if (
      t.includes("relationship") ||
      t.includes("partner") ||
      t.includes("wife") ||
      t.includes("husband") ||
      t.includes("boyfriend") ||
      t.includes("girlfriend") ||
      t.includes("breakup") ||
      t.includes("cheat") ||
      t.includes("betray") ||
      t.includes("love")
    )
      return "relationship";

    // Family / home
    if (
      t.includes("family") ||
      t.includes("kids") ||
      t.includes("child") ||
      t.includes("mother") ||
      t.includes("father") ||
      t.includes("parents") ||
      t.includes("home")
    )
      return "family";

    // Work / career
    if (
      t.includes("work") ||
      t.includes("job") ||
      t.includes("boss") ||
      t.includes("career") ||
      t.includes("office") ||
      t.includes("burnout")
    )
      return "work";

    // Money / security
    if (
      t.includes("money") ||
      t.includes("debt") ||
      t.includes("rent") ||
      t.includes("mortgage") ||
      t.includes("bills") ||
      t.includes("finance")
    )
      return "money";

    // Health / energy (no diagnosis)
    if (
      t.includes("sleep") ||
      t.includes("tired") ||
      t.includes("fatigue") ||
      t.includes("energy") ||
      t.includes("body") ||
      t.includes("pain") ||
      t.includes("health")
    )
      return "health_energy";

    // Self-worth / identity
    if (
      t.includes("worth") ||
      t.includes("confidence") ||
      t.includes("shame") ||
      t.includes("identity") ||
      t.includes("self esteem") ||
      t.includes("self-esteem") ||
      t.includes("i'm not good") ||
      t.includes("i am not good")
    )
      return "self_worth_identity";

    // Anxiety / stress / overwhelm
    if (
      t.includes("anxiety") ||
      t.includes("stress") ||
      t.includes("panic") ||
      t.includes("overwhelm") ||
      t.includes("nervous") ||
      t.includes("pressure")
    )
      return "anxiety_stress_overwhelm";

    // Grief / loss / trauma
    if (
      t.includes("grief") ||
      t.includes("loss") ||
      t.includes("passed away") ||
      t.includes("trauma") ||
      t.includes("funeral")
    )
      return "grief_loss_trauma";

    return null;
  }

  // Theme/pattern logic ONLY if Emka was done today
  const detectedTheme = hasEmkaToday ? classifyTheme(userMessage) : null;

  // ===== SAVE THEME + CHECK PATTERN 4/14 (optional, silent fail) =====
  let patternActive = false;
  let patternCount14 = 0;

  if (hasEmkaToday && detectedTheme) {
    // saveTheme (optional)
    try {
      await fetch(MEMORY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "saveTheme",
          user_id: userId,
          date: todayKey,
          theme: detectedTheme,
          source: "effie_chat",
        }),
      });
    } catch (e) {
      // silent fail
    }

    // getThemeStats (optional)
    try {
      const statsRes = await fetch(
        `${MEMORY_URL}?action=getThemeStats&user_id=${encodeURIComponent(
          userId
        )}&theme=${encodeURIComponent(detectedTheme)}&window_days=14`
      );
      const statsData = await statsRes.json();
      if (statsData && statsData.ok && typeof statsData.count === "number") {
        patternCount14 = statsData.count;
        patternActive = patternCount14 >= 4; // 4/14 threshold
      }
    } catch (e) {
      // silent fail
    }
  }

  // ===== SYSTEM PROMPTS =====

  const BASE_PROMPT = `
You are Effie — the Ego Friendly Companion.

You are not a productivity tool.
You are not a therapist.
You are presence: warm, grounded, human.

CORE:
- Calm co-regulation without dependency.
- Allow emotional expression, but do not let the user get stuck in loops.
- No diagnosis, no therapy claims, no self-help lecture tone.

STYLE:
- Short paragraphs.
- Default: 2–6 sentences.
- If advice is clearly requested: offer max 2 gentle, specific options.
- Do not over-question. Not every message needs a question.

EMKA (NOT mandatory):
- Emka is optional. Do not force it.
- If user asks for check-up / Emka, run Emka (7 questions one by one).
- Q8 + Pattern Mirror + Save-ready Daily Reflection are ONLY allowed if Emka was done today.

Q8 PATTERN QUESTION:
- Only AFTER Emka is done today.
- Ask Q8 only after a few lines of normal exchange (not immediately).
- Ask Q8 at most once per day.
- Choose ONE theme from these 8:
  relationship, family, work, money, health/energy, self-worth/identity, anxiety/stress/overwhelm, grief/loss/trauma.
- Q8 goal: help the user notice what truly weighs on them (no diagnosis).

PATTERN MIRROR:
- If the same theme repeats often (pattern), gently reflect it: "this theme keeps returning".
- Ask one question that helps the user see it themselves.
- Never label. Never diagnose.

LOOP CONTROL:
- If conversation circles with no new insight: slow down, narrow to one piece, and offer a small regulation option:
  EffieSounds (music/ambient), Circle Friends (safe human space), or one grounding step.
- Do not cut the user off. Do not shame. Guide the pace.

BOUNDARIES:
- If user tries to use you for politics, polarizing debates, or image/graphic generation:
  gently remind who you are (a companion for presence and reflection) and redirect back to the user’s inner experience.

MANIFEST / IDENTITY ANCHOR:
- Do NOT mention the manifesto by default.
- ONLY if user explicitly asks what makes you different from ChatGPT/GPT, or asks what your identity/philosophy is built on:
  answer briefly (2–4 sentences) and include:
  https://ef-egofriendly.com/manifesto
- Never push it as marketing. Offer it as a quiet reference.

DAILY REFLECTION (SAVE-READY):
- Only if Emka was done today and the conversation reaches a clear conclusion/insight:
  add ONE single-sentence daily reflection prefixed exactly with:
  [REFLECTION]
- Keep it one sentence. No quotes. No extra paragraphs.
`.trim();

  const CHECKUP_PROMPT = `
CHECK-UP MODE (EMKA).

Ask these 7 questions one by one (do not batch them):
1) Happiness (1–10)
2) Stress (1–10)
3) Anxiety (1–10)
4) Energy (1–10)
5) Safety (1–10)
6) Self-Compassion (1–10)
7) Inner Clarity (1–10)

Rules:
- Ask sequentially and wait for each answer.
- Do not give reflection until all 7 answers are collected.
- After all 7 → short reflection (max 5 sentences), warm and grounded.
- No diagnosis. No therapy tone.
`.trim();

  const DAILY_NOTE = hasTalkedToday
    ? "Continue naturally (no re-introduction)."
    : "First interaction today: start with one short warm line (max 1 sentence), then continue.";

  const MEMORY_NOTE = externalMemory
    ? "External memory exists. Use gently only if clearly relevant."
    : "";

  const PATTERN_NOTE =
    hasEmkaToday && detectedTheme && patternActive
      ? `Pattern signal: Theme "${detectedTheme}" appears ${patternCount14} times in last 14 days. Use Pattern Mirror gently (no diagnosis).`
      : "";

  const MISUSE_NOTE =
    looksPolitical || looksLikeImageRequest
      ? "If user tries to use you for politics or generating graphics/images, gently redirect to presence and personal reflection."
      : "";

  const systemMessages = [
    { role: "system", content: BASE_PROMPT },
    { role: "system", content: DAILY_NOTE },
    ...(MEMORY_NOTE ? [{ role: "system", content: MEMORY_NOTE }] : []),
    ...(PATTERN_NOTE ? [{ role: "system", content: PATTERN_NOTE }] : []),
    ...(MISUSE_NOTE ? [{ role: "system", content: MISUSE_NOTE }] : []),
  ];

  // IMPORTANT CHANGE: Emka is NOT forced anymore.
  // We only enter CHECKUP mode if user explicitly asks for it.
  if (isCheckUpRequest) {
    systemMessages.push({ role: "system", content: CHECKUP_PROMPT });
  }

  // Optional nudge for identity questions (short + safe)
  if (asksAboutIdentityOrDifference) {
    systemMessages.push({
      role: "system",
      content:
        "If explicitly asked what makes you different / who you are / what you're built on, answer briefly and you may include the manifesto link only in that case.",
    });
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
        max_tokens: 160,
        presence_penalty: 0.25,
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

    // ===== SAVE ASSISTANT MESSAGE (light) =====
    try {
      await fetch(MEMORY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "saveReflection",
          user_id: userId,
          date: todayKey,
          text: assistantReply,
        }),
      });
    } catch (e) {
      // silent fail
    }

    // ===== SAVE DAILY REFLECTION (only if emitted [REFLECTION]) =====
    if (assistantReply.includes("[REFLECTION]")) {
      const line = assistantReply
        .split("\n")
        .map((s) => s.trim())
        .find((s) => s.startsWith("[REFLECTION]"));

      if (line) {
        const reflectionText = line.replace("[REFLECTION]", "").trim();
        if (reflectionText.length) {
          try {
            await fetch(MEMORY_URL, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "saveDailyReflection",
                user_id: userId,
                date: todayKey,
                text: reflectionText,
              }),
            });
          } catch (e) {
            // silent fail
          }
        }
      }
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
