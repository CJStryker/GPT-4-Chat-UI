const OLLAMA_ENDPOINT = "http://69.142.141.135:11434/api/chat";
const OLLAMA_MODEL = "gpt-oss:120b";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  if (!req.body || !req.body.messages) {
    res.status(400).json({ error: "Bad Request: messages field is required" });
    return;
  }

  const payload = {
    model: OLLAMA_MODEL,
    messages: req.body.messages,
    stream: false
  };

  try {
    const response = await fetch(OLLAMA_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      res.status(response.status).json({
        error: "Ollama request failed",
        details: errorText
      });
      return;
    }

    const data = await response.json();
    const resultMessage = data?.message ?? data?.result ?? null;

    if (!resultMessage || !resultMessage.content) {
      res.status(502).json({ error: "Invalid response from Ollama" });
      return;
    }

    res.status(200).json({ result: resultMessage });
  } catch (error) {
    res.status(500).json({ error: "Failed to contact Ollama", details: error.message });
  }
}
