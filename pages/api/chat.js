// pages/api/chat.js
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

  // Modes:
  //  - ?sse=1       => SSE streaming (EventSource)
  //  - ?stream=0    => non-stream JSON (one-shot)
  //  - default      => NDJSON streaming passthrough (fetch reader)
  const useSSE = req.query.sse === "1";
  const forceJSON = req.query.stream === "0";

  // ---------- Non-stream JSON mode ----------
  if (forceJSON) {
    const payload = {
      model: OLLAMA_MODEL,
      messages: req.body.messages,
      stream: false,
    };

    try {
      const response = await fetch(OLLAMA_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        res.status(response.status).json({
          error: "Ollama request failed",
          details: errorText,
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
      return;
    } catch (error) {
      res.status(500).json({
        error: "Failed to contact Ollama",
        details: error.message,
      });
      return;
    }
  }

  // ---------- Streaming modes (SSE or NDJSON) ----------
  const payload = {
    model: OLLAMA_MODEL,
    messages: req.body.messages,
    stream: true,
  };

  if (useSSE) {
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
  } else {
    // NDJSON passthrough
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
  }

  const controller = new AbortController();
  const { signal } = controller;

  // Abort upstream when client disconnects
  req.on("close", () => controller.abort());

  try {
    const upstream = await fetch(OLLAMA_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });

    if (!upstream.ok || !upstream.body) {
      const errText = await upstream.text().catch(() => "");
      res
        .status(upstream.status || 502)
        .end(JSON.stringify({ error: "Ollama request failed", details: errText || "No body returned" }));
      return;
    }

    const reader = upstream.body.getReader();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      const textChunk = decoder.decode(value, { stream: true });

      if (useSSE) {
        // Ollama emits JSON lines; wrap each non-empty line as SSE
        for (const line of textChunk.split(/\r?\n/)) {
          if (!line) continue;
          res.write(`data: ${line}\n\n`);
        }
      } else {
        // NDJSON passthrough (no transform)
        res.write(encoder.encode(textChunk));
      }
    }

    if (useSSE) {
      res.write("event: end\ndata: [DONE]\n\n");
    }
    res.end();
  } catch (error) {
    if (res.headersSent) {
      if (useSSE) res.write(`event: error\ndata: ${JSON.stringify(error.message)}\n\n`);
      try { res.end(); } catch {}
      return;
    }
    res.status(500).json({ error: "Failed to contact Ollama", details: error.message });
  }
}
