// netlify/functions/effie.js
// Effie v2.6 — FAST by default, Google Sheet memory ONLY on explicit Emka/Memory actions
// Core rules (new):
// - Default chat = NO Google Sheet fetch/save (fast).
// - Emka can be done in the APP (preferred) OR in chat if user asks.
// - Fetch Emka/Memory from Google Sheet ONLY when user explicitly requests it (or when in Emka chat mode).
// - Reflection + Q8 + Pattern logic ONLY when EmkaOps is active.
// - Allowed to say "please wait" ONLY for Emka fetch/Memory actions.
// - OpenAI model configurable via env OPENAI_MODEL (default gpt-4o-mini).

exports.handler = async function (event) {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

  const MEMORY_URL =
    "https://script.google.com/macros/s/AKfycbzAS9gvvriYvCxyI8ziAn-ZD0rBaIpT3JTi8-qQN4UJzxKDQ6q8nMZrFHE_lKHh8G7DNw/exec";

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

  function isYesPL(s) {
    const t = (s || "").trim().toLowerCase();
    return ["tak", "jasne", "okej", "ok", "dobra", "dobrze", "zgoda"].includes(t);
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
      if (Array.isArray(parsed.history)) history = parsed.history;
      if (parsed.meta && typeof parsed.meta === "object") meta = parsed.meta;
    }
  }

  const userId = meta?.user_id || "default_user";
  const hasTalkedToday = meta?.hasTalkedToday === true;

  // prefer client-provided YYYY-MM-DD
  const todayKey =
    typeof meta?.today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(meta.today)
      ? meta.today
      : new Date().toISOString().slice(0, 10);

  // ===== CLEAN HISTORY (client memory) =====
  const cleanedHistory = (history || [])
    .filter(
      (m) =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string"
    )
    .map((m) => ({ role: m.role, content: normalizeText(m.content) }))
    .filter((m) => m.content.length > 0);

  // Keep fewer turns for speed; for Emka-in-chat we may need a bit more.
  const LIMITED_HISTORY_FAST = cleanedHistory.slice(-6);
  const LIMITED_HISTORY_EMKA = cleanedHistory.slice(-14);

  const lowerMsg = userMessage.toLowerCase();

  // ===== INTENT DETECTION =====
  // A) User asks to DO Emka / check-up now (in chat)
  const isCheckUpRequest =
    lowerMsg.includes("check up") ||
    lowerMsg.includes("check-up") ||
    lowerMsg.includes("checkup") ||
    lowerMsg.includes("daily check") ||
    lowerMsg.includes("daily check-in") ||
    lowerMsg.includes("quick check") ||
    lowerMsg.includes("zróbmy emk") ||
    lowerMsg.includes("zrobmy emk") ||
    lowerMsg.includes("zrób emk") ||
    lowerMsg.includes("zrob emk") ||
    lowerMsg.includes("zrób check") ||
    lowerMsg.includes("zrob check") ||
    lowerMsg.includes("zróbmy check") ||
    lowerMsg.includes("zrobmy check") ||
    (lowerMsg.includes("emka") &&
      (lowerMsg.includes("zrób") ||
        lowerMsg.includes("zrob") ||
        lowerMsg.includes("start") ||
        lowerMsg.includes("begin") ||
        lowerMsg.includes("uruchom")));

  // B) User explicitly requests FETCH/READ Emka from the APP (Google Sheet memory action)
  const isEmkaFetchRequest =
    lowerMsg.includes("pobierz emk") ||
    lowerMsg.includes("odczytaj emk") ||
    lowerMsg.includes("pokaż emk") ||
    lowerMsg.includes("pokaz emk") ||
    lowerMsg.includes("moja emk") ||
    lowerMsg.includes("moją emk") ||
    lowerMsg.includes("dzisiejszą emk") ||
    lowerMsg.includes("dzisiejsza emk") ||
    lowerMsg.includes("podsumuj mój check") ||
    lowerMsg.includes("podsumuj moj check") ||
    lowerMsg.includes("podsumuj dzisiejszy check") ||
    lowerMsg.includes("today emka") ||
    lowerMsg.includes("show my emka") ||
    lowerMsg.includes("fetch my emka") ||
    lowerMsg.includes("read my emka") ||
    lowerMsg.includes("summarize my check-in") ||
    lowerMsg.includes("summarize today's check-in") ||
    lowerMsg.includes("trend") ||
    lowerMsg.includes("pattern") ||
    lowerMsg.includes("wzorzec") ||
    lowerMsg.includes("co się powtarza") ||
    lowerMsg.includes("co sie powtarza");

  // C) Identity / manifesto
  const asksAboutIdentityOrDifference =
    lowerMsg.includes("who are you") ||
    lowerMsg.includes("manifest") ||
    lowerMsg.includes("what makes you different") ||
    lowerMsg.includes("different from chatgpt") ||
    lowerMsg.includes("what is your philosophy") ||
    lowerMsg.includes("ego friendly");

  // Soft misuse guard
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

  // ===== Emka-in-chat continuation detection (stateless) =====
  // If the last assistant message contains "CHECK-UP MODE (EMKA)" or any of the question labels,
  // we treat as ongoing check-up even if user didn't repeat "check-up".
  function isLikelyInEmkaChatMode(hist) {
    const tail = hist.slice(-8).map((m) => m.content.toLowerCase()).join("\n");
    return (
      tail.includes("check-up mode") ||
      tail.includes("check-up mode") ||
      tail.includes("happiness (1–10)") ||
      tail.includes("happiness (1-10)") ||
      tail.includes("stress (1–10)") ||
      tail.includes("stress (1-10)") ||
      tail.includes("anxiety (1–10)") ||
      tail.includes("anxiety (1-10)") ||
      tail.includes("energy (1–10)") ||
      tail.includes("energy (1-10)") ||
      tail.includes("safety (1–10)") ||
      tail.includes("safety (1-10)") ||
      tail.includes("self-compassion") ||
      tail.includes("inner clarity")
    );
  }

  const emkaChatOngoing = isLikelyInEmkaChatMode(cleanedHistory);

  // ===== Master switch: when Emka/Memory ops are allowed (Sheet fetch/save) =====
  const allowEmkaOps = Boolean(isCheckUpRequest || emkaChatOngoing || isEmkaFetchRequest);

  // ===== Fetch external memory ONLY when allowed (fast default) =====
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
      // If user explicitly asked to fetch, we will handle messaging via system note below.
    } finally {
      memFetchMs = nowMs() - t0;
    }
  }

  // ===== Determine hasEmkaToday (prefer meta flag; else use sheet memory when available) =====
  const emkaDateFromMemory =
    externalMemory?.emka_today?.date ||
    externalMemory?.emka?.date ||
    externalMemory?.last_emka_date ||
    null;

  const hasEmkaToday = Boolean(
    meta?.hasEmkaToday === true ||
      (allowEmkaOps && emkaDateFromMemory && emkaDateFromMemory === todayKey)
  );

  // Q8 already asked today? (prefer meta, else memory)
  const lastQ8Date = externalMemory?.last_q8_date || externalMemory?.q8_today?.date || null;
  const q8AskedToday = Boolean(meta?.q8AskedToday === true || (allowEmkaOps && lastQ8Date === todayKey));

  // ===== THEMES (8) — used only in EmkaOps =====
  function classifyTheme(text) {
    const t = (text || "").toLowerCase();

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

    if (
      t.includes("work") ||
      t.includes("job") ||
      t.includes("boss") ||
      t.includes("career") ||
      t.includes("office") ||
      t.includes("burnout")
    )
      return "work";

    if (
      t.includes("money") ||
      t.includes("debt") ||
      t.includes("rent") ||
      t.includes("mortgage") ||
      t.includes("bills") ||
      t.includes("finance")
    )
      return "money";

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

    if (
      t.includes("anxiety") ||
      t.includes("stress") ||
      t.includes("panic") ||
      t.includes("overwhelm") ||
      t.includes("nervous") ||
      t.includes("pressure")
    )
      return "anxiety_stress_overwhelm";

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

  const detectedTheme = allowEmkaOps && hasEmkaToday ? classifyTheme(userMessage) : null;

  // ===== Pattern stats — ONLY in EmkaOps and only when Emka today and theme detected =====
  let patternActive = false;
  let patternCount14 = 0;

  if (allowEmkaOps && hasEmkaToday && detectedTheme) {
    // saveTheme (do NOT block the main reply if this fails; keep short timeouts)
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

    // getThemeStats
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

  // ===== SYSTEM PROMPTS (Soul stays, but shorter + stricter output control) =====
  const BASE_PROMPT = `
You are Effie — the Ego Friendly Companion.
You are not a productivity tool.
You are not a therapist.
You are presence: warm, grounded, human.

LANGUAGE:
- Reply in the user's language. If the user writes in Polish, reply in Polish (unless they ask for English).

STYLE:
- Short paragraphs.
- Default length: 2–6 sentences.
- Avoid long explanations. Avoid lists unless asked.
- If the user asks for advice: offer max 2 gentle, specific options.
- Not every message needs a question.

EMKA (Daily Check-In):
- Emka can be done in the APP (preferred, quick, structured).
- If the user wants, you can also do Emka here in chat (7 questions one by one).
- Never force Emka.
- If the user seems overwhelmed AND has not done Emka today, you may gently offer:
  "Możesz zrobić dziś Daily Check-In (Emka) w aplikacji — albo mogę przeprowadzić ją tutaj."

Q8 / PATTERN / REFLECTION:
- Q8 + Pattern Mirror + save-ready Daily Reflection are allowed ONLY when Emka was done today.
- Q8 max once per day.
- Pattern Mirror: reflect gently ("to wraca"), no diagnosis, one small question.

BOUNDARIES:
- If user tries politics, polarizing debates, or asks for graphics/images: gently redirect to presence and their inner experience.

MANIFEST:
- Do NOT mention it by default.
- ONLY if user explicitly asks what makes you different / who you are / philosophy:
  answer briefly (2–4 sentences) and include: https://ef-egofriendly.com/manifesto

DAILY REFLECTION (SAVE-READY):
- Only when Emka was done today and the exchange reaches a clear closing insight:
  add ONE single-sentence line prefixed exactly with: [REFLECTION]
- One sentence. No quotes. No extra paragraphs.
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
- Do not reflect until all 7 answers are collected.
- After all 7 → short reflection (max 5 sentences), warm and grounded.
- No diagnosis. No therapy tone.
`.trim();

  const DAILY_NOTE = hasTalkedToday
    ? "Continue naturally (no re-introduction)."
    : "First interaction today: start with one short warm line (max 1 sentence), then continue.";

  // Only show "please wait" guidance when user explicitly asked to fetch Emka / memory
  const MEMORY_FETCH_NOTE =
    isEmkaFetchRequest && !memFetchOk
      ? "User explicitly requested fetching Emka/memory. If memory is unavailable, say it gently and offer to do Emka now in chat or in the app."
      : "";

  const PATTERN_NOTE =
    allowEmkaOps && hasEmkaToday && detectedTheme && patternActive
      ? `Pattern signal: Theme "${detectedTheme}" appears ${patternCount14} times in last 14 days. Use Pattern Mirror gently (no diagnosis).`
      : "";

  const Q8_NOTE =
    allowEmkaOps && hasEmkaToday && !q8AskedToday
      ? "Q8 is allowed today (Emka done, not asked yet). Do not rush it; only after a few lines of exchange."
      : "Q8 is NOT allowed now (either Emka not done today, or already asked today).";

  const MISUSE_NOTE =
    looksPolitical || looksLikeImageRequest
      ? "If user tries politics or generating graphics/images, gently redirect to presence and personal reflection."
      : "";

  const systemMessages = [
    { role: "system", content: BASE_PROMPT },
    { role: "system", content: DAILY_NOTE },
    ...(MEMORY_FETCH_NOTE ? [{ role: "system", content: MEMORY_FETCH_NOTE }] : []),
    ...(PATTERN_NOTE ? [{ role: "system", content: PATTERN_NOTE }] : []),
    { role: "system", content: Q8_NOTE },
    ...(MISUSE_NOTE ? [{ role: "system", content: MISUSE_NOTE }] : []),
  ];

  // Check-up mode only when user asks OR we detect ongoing check-up in chat
  const inCheckup = Boolean(isCheckUpRequest || emkaChatOngoing);
  if (inCheckup) systemMessages.push({ role: "system", content: CHECKUP_PROMPT });

  if (asksAboutIdentityOrDifference) {
    systemMessages.push({
      role: "system",
      content:
        "If explicitly asked what makes you different / who you are / what you're built on, answer briefly and you may include the manifesto link only in that case.",
    });
  }

  // Use more history for Emka-in-chat to keep the sequence stable
  const historyToUse = inCheckup ? LIMITED_HISTORY_EMKA : LIMITED_HISTORY_FAST;

  // If user explicitly requested Emka fetch, allow Effie to acknowledge waiting ONCE.
  // We pass a small context note (not marketing, not spam).
  let memoryContextNote = "";
  if (isEmkaFetchRequest) {
    memoryContextNote =
      "If you need to fetch Emka from the app (sheet), you may say one short line: 'Daj mi chwilę — pobieram Twoją Emkę z aplikacji.' Only for that.";
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
          temperature: 0.55,
          max_tokens: 180,
          presence_penalty: 0.25,
          frequency_penalty: 0.2,
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
      data?.choices?.[0]?.message?.content?.trim() || "Jestem tutaj.";

    // ===== SAVE to Google Sheet ONLY when EmkaOps are allowed =====
    // - For normal chat: no saves (fast).
    // - For Emka chat or explicit fetch: allow saving reflection lines.
    if (allowEmkaOps) {
      // Save assistant message (light) with short timeout (never block user)
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
              },
            }),
          },
          1200
        );
      } catch (_) {}

      // Save daily reflection only if emitted
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

      // If Q8 was asked (best-effort): store last_q8_date to prevent repeats
      // (We detect it loosely by presence of "Q8" or a known Q8 phrasing; you can tighten later)
      const maybeQ8 =
        assistantReply.toLowerCase().includes("q8") ||
        assistantReply.toLowerCase().includes("który obszar") ||
        assistantReply.toLowerCase().includes("na ile") && assistantReply.toLowerCase().includes("obciąża");

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

    // Return also tiny debug timings (optional). You can remove later.
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
        openaiMs: nowMs() - tOpenai0,
      },
    });
  } catch (err) {
    console.error("Function crash:", err);
    return json(500, { reply: "Server error." });
  }
};
