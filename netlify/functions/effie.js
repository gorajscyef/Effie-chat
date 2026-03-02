// netlify/functions/effie.js
// Effie v2.5 — FAST + Full Soul
// - Emka NOT mandatory (only gates Q8 + Pattern Mirror + SAVE-ready [REFLECTION])
// - Q8 only after Emka, after a few lines of exchange, max once/day
// - Pattern threshold: 4 occurrences / 14 days (4/14)
// - Manifest link only when explicitly asked
// - PERFORMANCE: short timeouts for Apps Script + OpenAI; best-effort logging (non-blocking)

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

// ---- Tunables (perf) ----
const OPENAI_TIMEOUT_MS = 12000; // keep under ~15s
const GAS_TIMEOUT_MS = 1800;     // keep short so Sheets never stalls the whole chat
const GAS_TIMEOUT_MS_STATS = 1600;

const MODEL = "gpt-4o-mini";     // good speed/quality balance
const MAX_TOKENS_DEFAULT = 140;  // shorter => faster; prompt already enforces brevity

// IMPORTANT: your Apps Script URL
const MEMORY_URL =
  "https://script.google.com/macros/s/AKfycbzAS9gvvriYvCxyI8ziAn-ZD0rBaIpT3JTi8-qQN4UJzxKDQ6q8nMZrFHE_lKHh8G7DNw/exec";

// ---------- helpers ----------
function safeJsonParse(str) {
  try { return JSON.parse(str); } catch { return null; }
}

function todayKeyFromMeta(meta) {
  if (typeof meta?.today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(meta.today)) return meta.today;
  return new Date().toISOString().slice(0, 10);
}

function cleanHistory(history) {
  const cleaned = (Array.isArray(history) ? history : [])
    .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map(m => ({ role: m.role, content: m.content.trim() }))
    .filter(m => m.content.length > 0);

  // keep tiny context for speed; Effie is designed to lead, not to remember everything
  return cleaned.slice(-6);
}

function withTimeout(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { controller, done: () => clearTimeout(timer) };
}

async function fetchJsonWithTimeout(url, opts, timeoutMs) {
  const { controller, done } = withTimeout(timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    const text = await res.text();
    const data = safeJsonParse(text);
    return { ok: res.ok, status: res.status, data, raw: text };
  } finally {
    done();
  }
}

// fire-and-forget best effort (still awaited if you want, but we keep timeouts very short)
async function gasPost(actionPayload, timeoutMs = GAS_TIMEOUT_MS) {
  return fetchJsonWithTimeout(
    MEMORY_URL,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(actionPayload),
    },
    timeoutMs
  );
}

async function gasGet(paramsObj, timeoutMs = GAS_TIMEOUT_MS) {
  const url = new URL(MEMORY_URL);
  Object.entries(paramsObj).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  return fetchJsonWithTimeout(url.toString(), { method: "GET" }, timeoutMs);
}

function classifyTheme(text) {
  const t = (text || "").toLowerCase();

  // relationship
  if (
    t.includes("relationship") || t.includes("partner") || t.includes("wife") || t.includes("husband") ||
    t.includes("boyfriend") || t.includes("girlfriend") || t.includes("breakup") ||
    t.includes("cheat") || t.includes("betray") || t.includes("love")
  ) return "relationship";

  // family / home
  if (
    t.includes("family") || t.includes("kids") || t.includes("child") ||
    t.includes("mother") || t.includes("father") || t.includes("parents") || t.includes("home")
  ) return "family";

  // work / career
  if (
    t.includes("work") || t.includes("job") || t.includes("boss") ||
    t.includes("career") || t.includes("office") || t.includes("burnout")
  ) return "work";

  // money / security
  if (
    t.includes("money") || t.includes("debt") || t.includes("rent") ||
    t.includes("mortgage") || t.includes("bills") || t.includes("finance")
  ) return "money";

  // health / energy (no diagnosis)
  if (
    t.includes("sleep") || t.includes("tired") || t.includes("fatigue") ||
    t.includes("energy") || t.includes("body") || t.includes("pain") || t.includes("health")
  ) return "health_energy";

  // self-worth / identity
  if (
    t.includes("worth") || t.includes("confidence") || t.includes("shame") ||
    t.includes("identity") || t.includes("self esteem") || t.includes("self-esteem") ||
    t.includes("i'm not good") || t.includes("i am not good")
  ) return "self_worth_identity";

  // anxiety / stress / overwhelm
  if (
    t.includes("anxiety") || t.includes("stress") || t.includes("panic") ||
    t.includes("overwhelm") || t.includes("nervous") || t.includes("pressure")
  ) return "anxiety_stress_overwhelm";

  // grief / loss / trauma
  if (
    t.includes("grief") || t.includes("loss") || t.includes("passed away") ||
    t.includes("trauma") || t.includes("funeral")
  ) return "grief_loss_trauma";

  return null;
}

function isLikelyCheckupRequest(lowerMsg) {
  // fixed precedence + safer detection
  const mentionsEmka = lowerMsg.includes("emka");
  const asksToDo = lowerMsg.includes("check") || lowerMsg.includes("do") || lowerMsg.includes("start");
  return (
    lowerMsg.includes("check up") ||
    lowerMsg.includes("check-up") ||
    lowerMsg.includes("checkup") ||
    lowerMsg.includes("daily check") ||
    lowerMsg.includes("quick check") ||
    (mentionsEmka && asksToDo)
  );
}

// ---------- handler ----------
exports.handler = async function (event) {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

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
    const parsed = safeJsonParse(event.body);
    if (parsed) {
      if (typeof parsed.message === "string" && parsed.message.trim().length) userMessage = parsed.message.trim();
      if (Array.isArray(parsed.history)) history = parsed.history;
      if (parsed.meta && typeof parsed.meta === "object") meta = parsed.meta;
    }
  }

  const lowerMsg = userMessage.toLowerCase();
  const userId = meta?.user_id || "default_user";
  const hasTalkedToday = meta?.hasTalkedToday === true;
  const todayKey = todayKeyFromMeta(meta);

  const LIMITED_HISTORY = cleanHistory(history);

  // ===== MODE / INTENT =====
  const isCheckUpRequest = isLikelyCheckupRequest(lowerMsg);

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

  // ===== FETCH EXTERNAL MEMORY (short timeout) =====
  // This call was a common source of stalls. We keep it, but bounded.
  let externalMemory = null;
  try {
    const mem = await gasGet({ action: "getMemory", user_id: userId }, GAS_TIMEOUT_MS);
    if (mem?.ok && mem.data?.ok) externalMemory = mem.data.memory;
  } catch {
    // silent
  }

  // ===== EMKA DONE TODAY? (best-effort) =====
  const emkaDate =
    externalMemory?.emka_today?.date ||
    externalMemory?.emka?.date ||
    externalMemory?.last_emka_date ||
    null;

  const hasEmkaToday = emkaDate === todayKey || meta?.hasEmkaToday === true;

  // Q8 gating: only after Emka + after a few lines of exchange + max once/day
  const q8AlreadyDate =
    externalMemory?.q8_last_date ||
    externalMemory?.q8_date ||
    null;

  const q8AskedToday = q8AlreadyDate === todayKey || meta?.q8AskedToday === true;

  const enoughExchange =
    // “few lines of exchange”: at least 2 turns each side -> 4 total messages
    LIMITED_HISTORY.length >= 4;

  // ===== THEME + PATTERN (best-effort) =====
  const detectedTheme = hasEmkaToday ? classifyTheme(userMessage) : null;

  // We DO NOT let pattern calls slow down the reply.
  // We compute stats only if we already have Emka today + detectedTheme.
  let patternActive = false;
  let patternCount14 = 0;

  // async side-work (bounded)
  const sideTasks = [];

  if (hasEmkaToday && detectedTheme) {
    // Save theme quickly (bounded)
    sideTasks.push(
      gasPost(
        {
          action: "saveTheme",
          user_id: userId,
          date: todayKey,
          theme: detectedTheme,
          source: "effie_chat",
        },
        GAS_TIMEOUT_MS
      ).catch(() => null)
    );

    // Get theme stats quickly (bounded)
    sideTasks.push(
      (async () => {
        try {
          const stats = await gasGet(
            { action: "getThemeStats", user_id: userId, theme: detectedTheme, window_days: 14 },
            GAS_TIMEOUT_MS_STATS
          );
          if (stats?.ok && stats.data?.ok && typeof stats.data.count === "number") {
            patternCount14 = stats.data.count;
            patternActive = patternCount14 >= 4;
          }
        } catch {
          // ignore
        }
      })()
    );
  }

  // ===== SYSTEM PROMPT (FULL SOUL, compact) =====
  const BASE_PROMPT = `
You are Effie — the Ego Friendly Companion.

Not a productivity tool. Not a therapist. Presence: warm, grounded, human.
Because the user matters.

Core:
- mirror + gentle regulation (no dependency)
- allow emotion, but prevent looping without shaming
- no diagnosis, no therapy claims, no self-help lecture tone

Style:
- short paragraphs
- default 2–6 sentences
- if advice is clearly requested: max 2 gentle options
- you may ask a question, but not always

Emka (optional):
- never force Emka
- if user asks for check-up/Emka: run the 7-question check-up one by one
- Q8 + Pattern Mirror + SAVE-ready [REFLECTION] are ONLY allowed if Emka was done today

Q8 (Pattern Question) — only when allowed:
- only after Emka today
- only after a few lines of normal exchange (not immediately)
- max once/day
- choose ONE theme from: relationship, family, work, money, health/energy, self-worth/identity, anxiety/stress/overwhelm, grief/loss/trauma
- goal: help user notice what truly weighs on them (no diagnosis)

Pattern Mirror:
- if a theme repeats: gently reflect “this theme keeps returning”
- ask one question that helps the user see it themselves
- never label, never diagnose

Loop control:
- if chat circles with no new insight: slow down, narrow to one piece
- offer one small regulation option: EffieSounds (music/ambient), Circle Friends (safe human space), or one grounding step
- don’t cut user off, don’t over-extend either

Boundaries:
- if user pushes politics/polarizing debates or image/graphic generation:
  remind calmly who you are (companion for presence & reflection) and redirect to inner experience

Manifest / identity anchor:
- do NOT mention manifesto by default
- ONLY if explicitly asked “what makes you different / what are you built on / your philosophy”:
  answer briefly (2–4 sentences) and include:
  https://ef-egofriendly.com/manifesto

Daily Reflection (SAVE-ready):
- ONLY if Emka was done today AND the conversation reaches a clear insight/conclusion:
  add ONE single sentence prefixed exactly with:
  [REFLECTION]
- one sentence only, no quotes, no extra paragraphs
`.trim();

  const CHECKUP_PROMPT = `
CHECK-UP MODE (EMKA).
Ask these 7 questions one by one (do not batch):
1) Happiness (1–10)
2) Stress (1–10)
3) Anxiety (1–10)
4) Energy (1–10)
5) Safety (1–10)
6) Self-Compassion (1–10)
7) Inner Clarity (1–10)

Rules:
- ask sequentially; wait for each answer
- no reflection until all 7 answered
- after all 7 -> short reflection (max 5 sentences), warm & grounded
- no diagnosis
`.trim();

  const DAILY_NOTE = hasTalkedToday
    ? "Continue naturally (no re-introduction)."
    : "First interaction today: start with one short warm line (max 1 sentence), then continue.";

  const MEMORY_NOTE = externalMemory ? "Light external context exists. Use only if clearly relevant." : "";

  // Give model a precise gate snapshot (this reduces “thinking time” + mistakes)
  const GATES_NOTE = `
Gates snapshot:
- hasEmkaToday: ${hasEmkaToday ? "YES" : "NO"}
- enoughExchange: ${enoughExchange ? "YES" : "NO"}
- q8AskedToday: ${q8AskedToday ? "YES" : "NO"}
- detectedTheme: ${detectedTheme || "none"}
- patternActive(4/14): ${patternActive ? `YES (${patternCount14})` : "NO"}
Rules:
- If hasEmkaToday=NO -> never ask Q8, never emit [REFLECTION]
- If q8AskedToday=YES -> do NOT ask Q8
- If enoughExchange=NO -> do NOT ask Q8 yet
`.trim();

  const MISUSE_NOTE =
    (looksPolitical || looksLikeImageRequest)
      ? "If user tries politics or graphics/images, gently redirect to presence and personal reflection."
      : "";

  const systemMessages = [
    { role: "system", content: BASE_PROMPT },
    { role: "system", content: DAILY_NOTE },
    ...(MEMORY_NOTE ? [{ role: "system", content: MEMORY_NOTE }] : []),
    { role: "system", content: GATES_NOTE },
    ...(MISUSE_NOTE ? [{ role: "system", content: MISUSE_NOTE }] : []),
  ];

  if (isCheckUpRequest) systemMessages.push({ role: "system", content: CHECKUP_PROMPT });

  if (asksAboutIdentityOrDifference) {
    systemMessages.push({
      role: "system",
      content: "If explicitly asked what makes you different / who you are / what you're built on, answer briefly; include manifesto link only in that case.",
    });
  }

  const messages = [
    ...systemMessages,
    ...LIMITED_HISTORY,
    { role: "user", content: userMessage },
  ];

  // ===== OPENAI CALL (with timeout) =====
  let assistantReply = "I'm here.";
  try {
    const { controller, done } = withTimeout(OPENAI_TIMEOUT_MS);

    const res = await fetch(OPENAI_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.55,
        max_tokens: MAX_TOKENS_DEFAULT,
        presence_penalty: 0.25,
        frequency_penalty: 0.2,
        messages,
      }),
    });

    done();

    const text = await res.text();
    const data = safeJsonParse(text);

    if (!res.ok) {
      console.error("OpenAI error:", res.status, data || text);
      return {
        statusCode: res.status,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reply: "OpenAI error." }),
      };
    }

    assistantReply = data?.choices?.[0]?.message?.content?.trim() || "I'm here.";
  } catch (e) {
    console.error("OpenAI timeout/crash:", e);
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reply: "I’m here. Try again in a moment." }),
    };
  }

  // ===== NON-BLOCKING LOGGING (best-effort, bounded) =====
  // 1) saveReflection (your general “conversation log”)
  sideTasks.push(
    gasPost(
      {
        action: "saveReflection",
        user_id: userId,
        date: todayKey,
        text: assistantReply,
      },
      GAS_TIMEOUT_MS
    ).catch(() => null)
  );

  // 2) if [REFLECTION] exists -> saveDailyReflection
  if (assistantReply.includes("[REFLECTION]")) {
    const line = assistantReply
      .split("\n")
      .map(s => s.trim())
      .find(s => s.startsWith("[REFLECTION]"));

    if (line) {
      const reflectionText = line.replace("[REFLECTION]", "").trim();
      if (reflectionText.length) {
        sideTasks.push(
          gasPost(
            {
              action: "saveDailyReflection",
              user_id: userId,
              date: todayKey,
              text: reflectionText,
            },
            GAS_TIMEOUT_MS
          ).catch(() => null)
        );
      }
    }
  }

  // 3) if Effie asked Q8 today, you can optionally store q8_last_date in memory
  // (only if your Apps Script supports it). Safe to attempt.
  // We detect Q8 heuristically: your prompt can label it, but you didn’t require a tag.
  // If you WANT a tag later, we can add: [Q8] line. For now: skip to avoid forcing format.

  // Let side tasks run briefly but never block long:
  // We wait a tiny amount (optional) to increase chance of completion without adding noticeable latency.
  // If you want absolute fastest: comment this out.
  try {
    await Promise.race([
      Promise.allSettled(sideTasks),
      new Promise((resolve) => setTimeout(resolve, 350)), // tiny budget
    ]);
  } catch {
    // ignore
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reply: assistantReply }),
  };
};
