exports.handler = async function(event) {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

  let message = "Hello";

  if (event.body) {
    try {
      const parsed = JSON.parse(event.body);
      message = parsed.message || "Hello";
    } catch (err) {
      message = "Hello";
    }
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are Effie. Calm. Minimal. Warm." },
        { role: "user", content: message }
      ]
    })
  });

  const data = await response.json();

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      reply: data.choices?.[0]?.message?.content || "No response"
    })
  };
};
