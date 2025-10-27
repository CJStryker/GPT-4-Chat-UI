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

  // If you’re using EventSource on the client, call /api/chat?sse=1
  const useSSE = req.query.sse === "1";

  // Build the Ollama payload with streaming enabled
  const payload = {
    model: OLLAMA_MODEL,
    messages: req.body.messages,
    stream: true,
  };

  // Prepare response headers before opening the upstream stream
  if (useSSE) {
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
  } else {
    // NDJSON-style passthrough (good for fetch() streaming readers)
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
  }

  // Make sure Node doesn’t buffer
  // (Next.js API routes are fine with res.write / res.flushHeaders implicitly)
  const controller = new AbortController();
  const { signal } = controller;

  // Abort upstream if client disconnects
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
      res.status(upstream.status || 502).end(
        JSON.stringify({
          error: "Ollama request failed",
          details: errText || "No body returned",
        })
      );
      return;
    }

    // Web ReadableStream -> iterate chunks and forward
    const reader = upstream.body.getReader();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      const textChunk = decoder.decode(value, { stream: true });

      if (useSSE) {
        // Wrap each line as an SSE event
        // Ollama emits JSON-per-line; we transform each non-empty line to: data: <line>\n\n
        for (const line of textChunk.split(/\r?\n/)) {
          if (!line) continue;
          res.write(`data: ${line}\n\n`);
        }
      } else {
        // Passthrough NDJSON (no transformation)
        res.write(encoder.encode(textChunk));
      }
    }

    // Finalize stream
    if (useSSE) {
      res.write("event: end\ndata: [DONE]\n\n");
    }
    res.end();
  } catch (error) {
    // If headers already sent, just terminate the stream
    if (res.headersSent) {
      if (useSSE) res.write(`event: error\ndata: ${JSON.stringify(error.message)}\n\n`);
      try { res.end(); } catch {}
      return;
    }
    res.status(500).json({ error: "Failed to contact Ollama", details: error.message });
  }
}
