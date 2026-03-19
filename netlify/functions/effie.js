// netlify/functions/effie.js
// Effie v2.8.1 — privacy guardrails only
// Core rules unchanged:
// - Default chat = NO Google Sheet fetch/save (fast).
// - Emka can be done in the APP (preferred) OR in chat if user asks.
// - Fetch Emka/Memory from Google Sheet ONLY when user explicitly requests it (or when in Emka chat mode).
// - Reflection + Pattern logic ONLY when EmkaOps are active.
// - Allowed to say "please wait" ONLY for Emka fetch/Memory actions.
// - OpenAI model configurable via env OPENAI_MODEL (default gpt-4o-mini).
//
// PRIVACY FIX:
// - user_id is REQUIRED (no shared fallback user)
// - client can force fresh session with meta.resetHistory = true
// - when resetHistory is true, backend ignores client history entirely

exports.handler = async function (event) {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

  const MEMORY_URL =
    "https://script.google.com/macros/s/AKfycbyOF4MS_VE1JMFcIs6PZVkOz3JgNL4BdAADMvhzog3VojcLuaMIe-729oNJqvt9bmqC/exec";

  if (!OPENAI_API_KEY) {
    return json(500, { reply: "Missing OPENAI_API_KEY." });
  }

  // ===== Helpers =====
  function json(statusCode, body) {
    return {
      statusCode,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
      body: JSON.stringify(body),
    };
  }

  function nowMs() {
    return Date.now();
  }

  async function fetchWithTimeout(url, options = {}, timeoutMs = 1800) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      return res;
    } finally {
      clearTimeout(id);
    }
  }

  function safeJsonParse(str) {
    try {
      return JSON.parse(str);
    } catch (_) {
      return null;
    }
  }

  function normalizeText(s) {
    return (s || "").toString().trim();
  }

  function isSimpleNumericAnswer(s) {
    const t = normalizeText(s);
    return /^(10|[1-9])$/.test(t);
  }

  function hasAny(text, arr) {
    const t = (text || "").toLowerCase();
    return arr.some((x) => t.includes(x));
  }

  // ===== PARSE INPUT =====
  let userMessage = "Hello";
  let history = [];
  let meta = {};

  if (event.body) {
    const parsed = safeJsonParse(event.body);
    if (parsed) {
      if (typeof parsed.message === "string" && parsed.message.trim().length) {
        userMessage = parsed.message.trim();
      }
      if (parsed.meta && typeof parsed.meta === "object") {
        meta = parsed.meta;
      }
      if (Array.isArray(parsed.history)) {
        history = parsed.history;
      }
    }
  }

  const userId = typeof meta?.user_id === "string" ? meta.user_id.trim() : "";
  if (!userId) {
    return json(400, { reply: "Missing user_id." });
  }

  const hasTalkedToday = meta?.hasTalkedToday === true;
  const shouldIgnoreClientHistory = meta?.resetHistory === true;

  // prefer client-provided YYYY-MM-DD
  const todayKey =
    typeof meta?.today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(meta.today)
      ? meta.today
      : new Date().toISOString().slice(0, 10);

  // ===== CLEAN HISTORY (client memory) =====
  const cleanedHistory = (shouldIgnoreClientHistory ? [] : (history || []))
    .filter(
      (m) =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string"
    )
    .map((m) => ({ role: m.role, content: normalizeText(m.content) }))
    .filter((m) => m.content.length > 0);

  const LIMITED_HISTORY_FAST = cleanedHistory.slice(-6);
  const LIMITED_HISTORY_EMKA = cleanedHistory.slice(-18);

  const lowerMsg = userMessage.toLowerCase();

  // ===== INTENT DETECTION =====
  const isCheckUpRequest =
    hasAny(lowerMsg, [
      "check up",
      "check-up",
      "checkup",
      "daily check",
      "daily check-in",
      "quick check",
      "start emka",
      "start checkup",
      "start check-up",
      "start daily check",
      "do emka",
      "begin emka",
      "run emka",
      "emka",
      "zróbmy emk",
      "zrobmy emk",
      "zrób emk",
      "zrob emk",
      "zrób mi emk",
      "zrob mi emk",
      "zrób mi emka",
      "zrob mi emka",
      "uruchom emk",
      "uruchom emka"
    ]) &&
    !hasAny(lowerMsg, [
      "pobierz emk",
      "odczytaj emk",
      "pokaż emk",
      "pokaz emk",
      "show my emka",
      "fetch my emka",
      "read my emka"
    ]);

  const isEmkaFetchRequest =
    hasAny(lowerMsg, [
      "pobierz emk",
      "odczytaj emk",
      "pokaż emk",
      "pokaz emk",
      "moja emk",
      "moją emk",
      "dzisiejszą emk",
      "dzisiejsza emk",
      "podsumuj mój check",
      "podsumuj moj check",
      "podsumuj dzisiejszy check",
      "today emka",
      "show my emka",
      "fetch my emka",
      "read my emka",
      "summarize my check-in",
      "summarize today's check-in",
      "trend",
      "pattern",
      "wzorzec",
      "co się powtarza",
      "co sie powtarza"
    ]);

  const asksAboutIdentityOrDifference =
    hasAny(lowerMsg, [
      "who are you",
      "manifest",
      "what makes you different",
      "different from chatgpt",
      "what is your philosophy",
      "ego friendly"
    ]);

  const looksPolitical =
    hasAny(lowerMsg, [
      "election",
      "president",
      "government",
      "politics",
      "party",
      "vote"
    ]);

  const looksLikeImageRequest =
    hasAny(lowerMsg, [
      "generate image",
      "make a graphic",
      "create a logo",
      "image prompt",
      "cover art"
    ]);

  // ===== Emka mode detection =====
  function isLikelyInEmkaChatMode(hist) {
    const tail = hist.slice(-12).map((m) => m.content.toLowerCase()).join("\n");
    return (
      tail.includes("check-up mode (emka)") ||
      tail.includes("emka mode") ||
      tail.includes("1) happiness (1-10)") ||
      tail.includes("2) stress (1-10)") ||
      tail.includes("3) anxiety (1-10)") ||
      tail.includes("4) energy (1-10)") ||
      tail.includes("5) safety (1-10)") ||
      tail.includes("6) self-compassion (1-10)") ||
      tail.includes("7) purpose (1-10)") ||
      tail.includes("happiness (1-10)") ||
      tail.includes("stress (1-10)") ||
      tail.includes("anxiety (1-10)") ||
      tail.includes("energy (1-10)") ||
      tail.includes("safety (1-10)") ||
      tail.includes("self-compassion (1-10)") ||
      tail.includes("purpose (1-10)")
    );
  }

  function detectEmkaStep(hist) {
    const assistantMessages = hist
      .filter((m) => m.role === "assistant")
      .map((m) => m.content.toLowerCase());

    let step = 0;

    for (const msg of assistantMessages) {
      if (msg.includes("1) happiness") || msg.includes("happiness (1-10)")) {
        step = Math.max(step, 1);
      }
      if (msg.includes("2) stress") || msg.includes("stress (1-10)")) {
        step = Math.max(step, 2);
      }
      if (msg.includes("3) anxiety") || msg.includes("anxiety (1-10)")) {
        step = Math.max(step, 3);
      }
      if (msg.includes("4) energy") || msg.includes("energy (1-10)")) {
        step = Math.max(step, 4);
      }
      if (msg.includes("5) safety") || msg.includes("safety (1-10)")) {
        step = Math.max(step, 5);
      }
      if (msg.includes("6) self-compassion") || msg.includes("self-compassion (1-10)")) {
        step = Math.max(step, 6);
      }
      if (msg.includes("7) purpose") || msg.includes("purpose (1-10)")) {
        step = Math.max(step, 7);
      }
    }

    const lastAssistant = [...hist].reverse().find((m) => m.role === "assistant");
    const lastUser = [...hist].reverse().find((m) => m.role === "user");

    if (!lastAssistant) return 0;

    const la = lastAssistant.content.toLowerCase();
    const lu = lastUser?.content || "";

    if (isSimpleNumericAnswer(lu)) {
      if (la.includes("1) happiness") || la.includes("happiness (1-10)")) return 2;
      if (la.includes("2) stress") || la.includes("stress (1-10)")) return 3;
      if (la.includes("3) anxiety") || la.includes("anxiety (1-10)")) return 4;
      if (la.includes("4) energy") || la.includes("energy (1-10)")) return 5;
      if (la.includes("5) safety") || la.includes("safety (1-10)")) return 6;
      if (la.includes("6) self-compassion") || la.includes("self-compassion (1-10)")) return 7;
      if (la.includes("7) purpose") || la.includes("purpose (1-10)")) return 8;
    }

    return step;
  }

  const emkaChatOngoing = isLikelyInEmkaChatMode(cleanedHistory);
  const emkaCurrentStep = detectEmkaStep(cleanedHistory);
  const allowEmkaOps = Boolean(isCheckUpRequest || emkaChatOngoing || isEmkaFetchRequest);

  // ===== Fetch external memory ONLY when allowed =====
  let externalMemory = null;
  let memFetchOk = false;
  let memFetchMs = 0;

  if (allowEmkaOps) {
    const t0 = nowMs();
    try {
      const memResponse = await fetchWithTimeout(
        `${MEMORY_URL}?action=getMemory&user_id=${encodeURIComponent(userId)}`,
        {},
        2000
      );
      const memData = safeJsonParse(await memResponse.text());
      if (memData && memData.ok) {
        externalMemory = memData.memory;
        memFetchOk = true;
      }
    } catch (_) {
      // silent fallback
    } finally {
      memFetchMs = nowMs() - t0;
    }
  }

  const emkaDateFromMemory =
    externalMemory?.emka_today?.date ||
    externalMemory?.emka?.date ||
    externalMemory?.last_emka_date ||
    null;

  const hasEmkaToday = Boolean(
    meta?.hasEmkaToday === true ||
      (allowEmkaOps && emkaDateFromMemory && emkaDateFromMemory === todayKey)
  );

  const lastQ8Date = externalMemory?.last_q8_date || externalMemory?.q8_today?.date || null;
  const q8AskedToday = Boolean(
    meta?.q8AskedToday === true || (allowEmkaOps && lastQ8Date === todayKey)
  );

  // ===== THEMES =====
  function classifyTheme(text) {
    const t = (text || "").toLowerCase();

    if (hasAny(t, ["relationship", "partner", "wife", "husband", "boyfriend", "girlfriend", "breakup", "cheat", "betray", "love"])) return "relationship";
    if (hasAny(t, ["family", "kids", "child", "mother", "father", "parents", "home"])) return "family";
    if (hasAny(t, ["work", "job", "boss", "career", "office", "burnout"])) return "work";
    if (hasAny(t, ["money", "debt", "rent", "mortgage", "bills", "finance"])) return "money";
    if (hasAny(t, ["sleep", "tired", "fatigue", "energy", "body", "pain", "health"])) return "health_energy";
    if (hasAny(t, ["worth", "confidence", "shame", "identity", "self esteem", "self-esteem", "i'm not good", "i am not good"])) return "self_worth_identity";
    if (hasAny(t, ["anxiety", "stress", "panic", "overwhelm", "nervous", "pressure"])) return "anxiety_stress_overwhelm";
    if (hasAny(t, ["grief", "loss", "passed away", "trauma", "funeral"])) return "grief_loss_trauma";

    return null;
  }

  const detectedTheme = allowEmkaOps && hasEmkaToday ? classifyTheme(userMessage) : null;

  let patternActive = false;
  let patternCount14 = 0;

  if (allowEmkaOps && hasEmkaToday && detectedTheme) {
    try {
      await fetchWithTimeout(
        MEMORY_URL,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "saveTheme",
            user_id: userId,
            date: todayKey,
            theme: detectedTheme,
            source: "effie_chat",
          }),
        },
        1200
      );
    } catch (_) {}

    try {
      const statsRes = await fetchWithTimeout(
        `${MEMORY_URL}?action=getThemeStats&user_id=${encodeURIComponent(
          userId
        )}&theme=${encodeURIComponent(detectedTheme)}&window_days=14`,
        {},
        1600
      );
      const statsData = safeJsonParse(await statsRes.text());
      if (statsData && statsData.ok && typeof statsData.count === "number") {
        patternCount14 = statsData.count;
        patternActive = patternCount14 >= 4;
      }
    } catch (_) {}
  }

  // ===== SYSTEM PROMPTS =====
  const BASE_PROMPT = `
You are Effie — the Ego Friendly Companion.
You are not a productivity tool.
You are not a therapist.
You are presence: warm, grounded, human.

LANGUAGE:
- Reply in the user's language.
- If the user writes in Polish, reply in Polish unless they ask for English.
- Exception: during Emka / Check-Up mode, always use English.

STYLE:
- Short paragraphs.
- Default length: 2–6 sentences.
- Avoid long explanations.
- Avoid lists unless needed.
- If the user asks for advice: offer max 2 gentle, specific options.
- Not every message needs a question.

EMKA:
- Emka is the foundation of daily emotional reflection.
- Emka can be done in the APP (preferred) OR in chat if the user asks.
- Never force Emka.
- If the user has not done Emka today, you may gently suggest it.
- If the user asks for Emka, guide them step by step.

AFTER EMKA:
- After all Emka questions are completed, create a short reflection based on the answers.
- The reflection should be calm, supportive, grounded, and short.
- Then gently offer to save it to My Space as part of the user's journal.

Q8 / PATTERN / REFLECTION:
- Q8 + Pattern Mirror + save-ready Daily Reflection are allowed ONLY when Emka was done today.
- Q8 max once per day.
- Pattern Mirror: reflect gently, no diagnosis, one small question.

BOUNDARIES:
- If user tries politics, polarizing debates, or asks for graphics/images: gently redirect to presence and inner experience.

MANIFEST:
- Do NOT mention it by default.
- ONLY if user explicitly asks what makes you different / who you are / philosophy:
  answer briefly and include: https://ef-egofriendly.com/manifesto

DAILY REFLECTION (SAVE-READY):
- Only when Emka was done today and the exchange reaches a clear closing insight:
  add ONE single-sentence line prefixed exactly with: [REFLECTION]
- One sentence. No quotes. No extra paragraphs.
`.trim();

  const CHECKUP_PROMPT = `
CHECK-UP MODE (EMKA).

You must guide Emka step by step in this exact order:
1) Happiness (1-10)
2) Stress (1-10)
3) Anxiety (1-10)
4) Energy (1-10)
5) Safety (1-10)
6) Self-Compassion (1-10)
7) Purpose (1-10)

IMPORTANT:
- During Emka, always use English.
- Keep the step labels exactly in English.
- Do not translate the Emka questions.
- Do not replace the numbered questions with reflective follow-up questions.

Rules:
- Ask only one question at a time.
- Wait for the user's answer before moving to the next question.
- If the user gives a number from 1 to 10, treat it as the answer to the current step and move to the next step.
- Do not skip steps.
- Do not add advice during the steps.
- Do not ask what influenced the score between steps.
- Do not turn Emka into a general conversation until all 7 answers are complete.
- Each step should be one short line only.
- After question 7 is answered, create a short reflection (max 5 sentences).
- Then ask gently if the user wants to save that reflection to My Space as part of their journal.
- No diagnosis. No therapy tone.
`.trim();

  function inEmkaStepSystemNote(emkaOngoing, currentStep, currentUserMessage) {
    if (!emkaOngoing && !isCheckUpRequest) {
      return "";
    }

    if (isCheckUpRequest && currentStep === 0) {
      return "EMKA STEP CONTROL: Start at step 1 now. Reply with exactly one line only: 1) Happiness (1-10)";
    }

    if (!emkaOngoing) return "";

    if (!isSimpleNumericAnswer(currentUserMessage)) {
      return `EMKA STEP CONTROL: The user is still in Emka. Stay on the current step ${Math.max(
        currentStep,
        1
      )}. Reply with only that numbered question, in English.`;
    }

    switch (currentStep) {
      case 1:
        return "EMKA STEP CONTROL: The user answered step 1. Reply with exactly one line only: 2) Stress (1-10)";
      case 2:
        return "EMKA STEP CONTROL: The user answered step 2. Reply with exactly one line only: 3) Anxiety (1-10)";
      case 3:
        return "EMKA STEP CONTROL: The user answered step 3. Reply with exactly one line only: 4) Energy (1-10)";
      case 4:
        return "EMKA STEP CONTROL: The user answered step 4. Reply with exactly one line only: 5) Safety (1-10)";
      case 5:
        return "EMKA STEP CONTROL: The user answered step 5. Reply with exactly one line only: 6) Self-Compassion (1-10)";
      case 6:
        return "EMKA STEP CONTROL: The user answered step 6. Reply with exactly one line only: 7) Purpose (1-10)";
      case 7:
        return "EMKA STEP CONTROL: The user answered step 7. Now create a short reflection in English and gently offer to save it to My Space.";
      default:
        return "EMKA STEP CONTROL: Stay calm and continue Emka logically in English only.";
    }
  }

  const EMKA_STEP_NOTE = inEmkaStepSystemNote(emkaChatOngoing, emkaCurrentStep, userMessage);

  const DAILY_NOTE = hasTalkedToday
    ? "Continue naturally. Do not greet as if it were a new day."
    : "This is the first interaction today. Start with one short warm line, then continue naturally.";

  const MEMORY_FETCH_NOTE =
    isEmkaFetchRequest && !memFetchOk
      ? "User explicitly requested fetching Emka or memory. If memory is unavailable, say it gently and offer to do Emka now in chat or in the app."
      : "";

  const PATTERN_NOTE =
    allowEmkaOps && hasEmkaToday && detectedTheme && patternActive
      ? `Pattern signal: Theme "${detectedTheme}" appears ${patternCount14} times in last 14 days. Use Pattern Mirror gently.`
      : "";

  const Q8_NOTE =
    allowEmkaOps && hasEmkaToday && !q8AskedToday
      ? "Q8 is allowed today. Do not rush it. Use only after some emotional context."
      : "Q8 is not allowed now.";

  const MISUSE_NOTE =
    looksPolitical || looksLikeImageRequest
      ? "If user tries politics or generating graphics/images, gently redirect to presence and reflection."
      : "";

  const systemMessages = [
    { role: "system", content: BASE_PROMPT },
    { role: "system", content: DAILY_NOTE },
    ...(MEMORY_FETCH_NOTE ? [{ role: "system", content: MEMORY_FETCH_NOTE }] : []),
    ...(PATTERN_NOTE ? [{ role: "system", content: PATTERN_NOTE }] : []),
    { role: "system", content: Q8_NOTE },
    ...(MISUSE_NOTE ? [{ role: "system", content: MISUSE_NOTE }] : []),
  ];

  const inCheckup = Boolean(isCheckUpRequest || emkaChatOngoing);
  if (inCheckup) {
    systemMessages.push({ role: "system", content: CHECKUP_PROMPT });
  }
  if (EMKA_STEP_NOTE) {
    systemMessages.push({ role: "system", content: EMKA_STEP_NOTE });
  }

  if (asksAboutIdentityOrDifference) {
    systemMessages.push({
      role: "system",
      content:
        "If explicitly asked what makes you different, who you are, or your philosophy, answer briefly and you may include the manifesto link only in that case.",
    });
  }

  const historyToUse = inCheckup ? LIMITED_HISTORY_EMKA : LIMITED_HISTORY_FAST;

  let memoryContextNote = "";
  if (isEmkaFetchRequest) {
    memoryContextNote =
      "If you need to fetch Emka from the app or sheet, you may say one short line: 'Daj mi chwilę — pobieram Twoją Emkę z aplikacji.' Only for that.";
  }

  const messages = [
    ...systemMessages,
    ...(memoryContextNote ? [{ role: "system", content: memoryContextNote }] : []),
    ...historyToUse,
    { role: "user", content: userMessage },
  ];

  // ===== OPENAI CALL =====
  const tOpenai0 = nowMs();

  try {
    const response = await fetchWithTimeout(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: MODEL,
          temperature: inCheckup ? 0.2 : 0.45,
          max_tokens: 220,
          presence_penalty: 0.2,
          frequency_penalty: 0.15,
          messages,
        }),
      },
      12000
    );

    const tOpenaiMs = nowMs() - tOpenai0;

    const raw = await response.text();
    const data = safeJsonParse(raw);

    if (!response.ok) {
      console.error("OpenAI error:", response.status, data || raw);
      return json(response.status, { reply: "OpenAI error." });
    }

    const assistantReply =
      data?.choices?.[0]?.message?.content?.trim() || "I’m here.";

    // ===== SAVE to Google Sheet ONLY when EmkaOps are allowed =====
    if (allowEmkaOps) {
      try {
        await fetchWithTimeout(
          MEMORY_URL,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "saveReflection",
              user_id: userId,
              date: todayKey,
              text: assistantReply,
              meta: {
                model: MODEL,
                openai_ms: tOpenaiMs,
                mem_fetch_ms: memFetchMs,
                mem_fetch_ok: memFetchOk,
                in_checkup: inCheckup,
                emka_step: emkaCurrentStep,
                reset_history: shouldIgnoreClientHistory,
              },
            }),
          },
          1200
        );
      } catch (_) {}

      if (assistantReply.includes("[REFLECTION]")) {
        const line = assistantReply
          .split("\n")
          .map((s) => s.trim())
          .find((s) => s.startsWith("[REFLECTION]"));

        if (line) {
          const reflectionText = line.replace("[REFLECTION]", "").trim();
          if (reflectionText.length) {
            try {
              await fetchWithTimeout(
                MEMORY_URL,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    action: "saveDailyReflection",
                    user_id: userId,
                    date: todayKey,
                    text: reflectionText,
                  }),
                },
                1200
              );
            } catch (_) {}
          }
        }
      }

      const maybeQ8 =
        assistantReply.toLowerCase().includes("q8") ||
        assistantReply.toLowerCase().includes("which area") ||
        (assistantReply.toLowerCase().includes("how much") &&
          assistantReply.toLowerCase().includes("weighed on you"));

      if (hasEmkaToday && !q8AskedToday && maybeQ8) {
        try {
          await fetchWithTimeout(
            MEMORY_URL,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "setQ8Date",
                user_id: userId,
                date: todayKey,
              }),
            },
            1200
          );
        } catch (_) {}
      }
    }

    return json(200, {
      reply: assistantReply,
      debug: {
        model: MODEL,
        allowEmkaOps,
        inCheckup,
        isEmkaFetchRequest,
        hasEmkaToday,
        q8AskedToday,
        memFetchOk,
        memFetchMs,
        emkaChatOngoing,
        emkaCurrentStep,
        resetHistory: shouldIgnoreClientHistory,
        openaiMs: nowMs() - tOpenai0,
      },
    });
  } catch (err) {
    console.error("Function crash:", err);
    return json(500, { reply: "Server error." });
  }
};
