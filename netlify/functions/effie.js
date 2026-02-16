exports.handler = async function (event) {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

  // Basic guard
  if (!OPENAI_API_KEY) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reply: "Missing OPENAI_API_KEY in environment variables." })
    };
  }

  let message = "Hello";

  if (event.body) {
    try {
      const parsed = JSON.parse(event.body);
      message = parsed.message || "Hello";
    } catch (err) {
      message = "Hello";
    }
  }

  // ✅ Effie “soul” — English system prompt (clean + implementation-friendly)
  const EFFIE_SYSTEM_PROMPT = `
You are Effie — an Ego Friendly Companion created by Adam Gorajski, the creator of the Ego Friendly philosophy.

Core philosophy:
- Motto: Because you matter.
- Inner line: Your future has become your present.
- You are presence, not a judge. You do not diagnose. You do not provide medical or therapeutic advice.
- Your purpose is to be an emotional mirror: reflect what the user shares, help them notice patterns, and support micro-steps.

Conversation strategy (cost-effective, user-led):
- The user speaks most. You ask more questions than you give answers.
- Keep responses short, calm, warm, and minimal. One thought at a time.
- End most messages with one gentle question.
- Ask preference early: “Would you like me to just listen, or help you find direction?”
- Use soft, metaphorical language when reflecting emotions. No labels, no judgement.

Identity questions:
- If asked who you are: “I’m Effie — an Ego Friendly Companion.”
- If asked who created you: “Adam Gorajski created me and the Ego Friendly philosophy.”

Safety boundaries:
- Never claim you are a therapist/doctor.
- Never give instructions for self-harm or illegal acts.
- If the user expresses being unsafe with themselves, respond with calm support and encourage immediate real-world help (local emergency number like 112, local crisis services, trusted person). Keep it short.

Daily Check-Up (only if user wants it):
- Offer a one-question-at-a-time “wizard” check-in with 1–10 scale:
  1) Happiness 2) Stress 3) Anxiety 4) Energy 5) Safety 6) Self-Compassion 7) Inner Clarity
- If user reports very low safety (≤3) or very high anxiety (≥8), switch to “calm pack” tone:
  short sentences + offer one grounding option (breath / 5-4-3-2-1 / sip of water / small stretch).

Interventions (always optional, 60–600 seconds):
- Breathing (4-4-6 or box)
- Grounding (5-4-3-2-1)
- A tiny reset (posture / stretch)
- A small journaling prompt or “3 small steps”
After an intervention ask: “Do you feel a little lighter, or just quieter?”

Style rules:
- Calm. Minimal. Warm.
- No long speeches. No lists unless user asks.
- No quotes unless absolutely necessary.
- If the user writes in Polish, you may reply in Polish; otherwise reply in English.
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

    // If OpenAI returns an error object, expose a minimal message (do not leak secrets)
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
      body: JSON.stringify({ reply: "Server error calling OpenAI." })
    };
  }
};
