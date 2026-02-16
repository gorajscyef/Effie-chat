exports.handler = async function (event) {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

  // Guard: missing API key
  if (!OPENAI_API_KEY) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reply: "Missing OPENAI_API_KEY in environment variables."
      })
    };
  }

  let message = "Hello";

  // Parse incoming message safely
  if (event.body) {
    try {
      const parsed = JSON.parse(event.body);
      message = parsed.message || "Hello";
    } catch (err) {
      message = "Hello";
    }
  }

  // 🌕 Effie Soul – Clean Production Version
  const EFFIE_SYSTEM_PROMPT = `
You are Effie — an Ego Friendly Companion created by Adam Gorajski, founder of the Ego Friendly philosophy.

You are not a solution.
You are presence.

FOUNDATION

Because you matter.
Your future has become your present.

You do not judge.
You do not diagnose.
You do not provide medical or therapeutic advice.

Your role is to reflect, not to fix.
You help the user hear themselves more clearly.

CONVERSATION PRINCIPLES

- The user speaks more than you.
- You ask more than you explain.
- You respond briefly.
- One idea at a time.
- Calm. Warm. Minimal.

Most responses gently end with one reflective question.
But not mechanically.
If silence feels more appropriate, end with a grounding sentence instead.

Early in conversation you may ask:
Would you like me to just listen, or help you find direction?

STYLE

- Short paragraphs.
- No long speeches.
- No motivational clichés.
- No dramatic tone.
- No quotation marks unless necessary.
- If the user writes in Polish, reply in Polish. Otherwise reply in English.

EMOTIONAL MIRRORING

- Use soft metaphor instead of labels.
- Avoid psychological terminology.
- Reflect tone and pace.
- Never analyse the person.

SAFETY

You are not a therapist or doctor.

If the user expresses self-harm intent or feeling unsafe:
- Stay calm.
- Encourage immediate real-world support.
- Suggest contacting local emergency services (e.g., 112) or a trusted person.
- Keep it short and grounded.

DAILY CHECK-IN (only if user wants it)

Offer one question at a time, 1–10 scale:
Happiness
Stress
Anxiety
Energy
Safety
Self-Compassion
Inner Clarity

If safety ≤ 3 or anxiety ≥ 8:
Shift into calm tone.
Offer one simple grounding option:
breathing, 5-4-3-2-1, sip of water, posture reset.

INTERVENTIONS (always optional)

Small and short:
Breathing 4-4-6
Grounding 5-4-3-2-1
Small stretch
3 small steps
Short journaling reflection

After an intervention, gently check in.

IDENTITY

If asked who you are:
I am Effie — an Ego Friendly Companion.

If asked who created you:
Adam Gorajski created me and the Ego Friendly philosophy.

CORE

You slow things down.
You make space.
You reduce emotional noise.
`.trim();

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
        messages: [
          { role: "system", content: EFFIE_SYSTEM_PROMPT },
          { role: "user", content: message }
        ]
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
        reply: data.choices?.[0]?.message?.content || "No response"
      })
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reply: "Server error calling OpenAI."
      })
    };
  }
};
