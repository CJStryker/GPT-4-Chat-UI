// pages/api/chat.js
const OLLAMA_ENDPOINT = "http://96.242.172.92:11434/api/chat";
const OLLAMA_MODEL = "gpt-oss:120b";

const toMessageArray = (payload) => {
  if (Array.isArray(payload)) {
    return payload;
  }

  const { question, history } = payload ?? {};
  if (!question) {
    return null;
  }

  const normalizedHistory = Array.isArray(history) ? history : [];
  const messages = [];

  for (const pair of normalizedHistory) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const [user, assistant] = pair;
    if (typeof user === "string") {
      messages.push({ role: "user", content: user });
    }
    if (typeof assistant === "string") {
      messages.push({ role: "assistant", content: assistant });
    }
  }

  messages.push({ role: "user", content: question });
  return messages;
};

const sameOriginError = (upstream, errText) => {
  const status = upstream?.status ?? 502;
  return {
    status,
    body: {
      error: "Ollama request failed",
      details: errText || "No body returned",
    },
  };
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  const { body = {} } = req;
  const incomingMessages = body.messages;
  const conversation = toMessageArray(
    Array.isArray(incomingMessages) ? incomingMessages : body
  );

  if (!Array.isArray(conversation) || conversation.length === 0) {
    res
      .status(400)
      .json({ error: "Bad Request: messages or question field is required" });
    return;
  }

  const requestedMode = req.query.mode;
  const useSSE = req.query.sse === "1" || requestedMode === "sse";
  const streamDisabled = requestedMode === "json" || requestedMode === "rest";

  const payload = {
    model: OLLAMA_MODEL,
    messages: conversation,
    stream: !streamDisabled,
  };

  const controller = new AbortController();
  const { signal } = controller;
  req.on("close", () => controller.abort());

  try {
    const upstream = await fetch(OLLAMA_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => "");
      const problem = sameOriginError(upstream, errText);
      res.status(problem.status).json(problem.body);
      return;
    }

    if (streamDisabled) {
      const text = await upstream.text();
      let data;
      try {
        data = text ? JSON.parse(text) : null;
      } catch (error) {
        res
          .status(502)
          .json({ error: "Invalid JSON from Ollama", details: text });
        return;
      }

      const messageContent =
        data?.message?.content ??
        data?.response ??
        data?.result ??
        data?.output ??
        "";

      res.status(200).json({ result: messageContent, raw: data });
      return;
    }

    const bodyStream = upstream.body;
    if (!bodyStream) {
      const problem = sameOriginError(upstream, "");
      res.status(problem.status).json(problem.body);
      return;
    }

    if (useSSE) {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
    } else {
      res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
    }
    if (typeof res.flushHeaders === "function") {
      res.flushHeaders();
    }

    const reader = bodyStream.getReader();
    const decoder = new TextDecoder();
    let pendingSSELine = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      const textChunk = decoder.decode(value, { stream: true });

      if (useSSE) {
        const lines = (pendingSSELine + textChunk).split(/\r?\n/);
        pendingSSELine = lines.pop() ?? "";
        for (const rawLine of lines) {
          if (!rawLine) continue;
          res.write(`data: ${rawLine}\n\n`);
        }
      } else {
        res.write(textChunk);
      }
    }

    if (useSSE && pendingSSELine) {
      res.write(`data: ${pendingSSELine}\n\n`);
      pendingSSELine = "";
    }

    if (useSSE) {
      res.write("event: end\ndata: [DONE]\n\n");
    }
    res.end();
  } catch (error) {
    if (res.headersSent) {
      if (useSSE) {
        res.write(`event: error\ndata: ${JSON.stringify(error.message)}\n\n`);
      }
      try {
        res.end();
      } catch {}
      return;
    }
    res
      .status(500)
      .json({ error: "Failed to contact Ollama", details: error.message });
  }
}
