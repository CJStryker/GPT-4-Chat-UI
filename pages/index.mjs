import { useState, useRef, useEffect } from 'react'
import Head from 'next/head'
import styles from '../styles/Home.module.css'
import Image from 'next/image'
import ReactMarkdown from 'react-markdown'
import CircularProgress from '@mui/material/CircularProgress';

const createMessage = (role, content = '') => ({
  role,
  type: role === 'user' ? 'userMessage' : 'apiMessage',
  content,
});

const messageRole = (message) => {
  if (message.role) return message.role;
  if (message.type === 'userMessage') return 'user';
  return 'assistant';
};

const computeHistoryPairs = (conversation) => {
  const pairs = [];
  let pendingUser = null;

  for (const entry of conversation) {
    const role = messageRole(entry);
    if (role === 'user') {
      pendingUser = entry.content ?? '';
    } else if (role === 'assistant' && pendingUser) {
      const assistantContent = entry.content ?? '';
      if (assistantContent) {
        pairs.push([pendingUser, assistantContent]);
        pendingUser = null;
      }
    }
  }

  return pairs;
};

export default function Home() {

  const [userInput, setUserInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [responseMode, setResponseMode] = useState("stream");
  const [messages, setMessages] = useState([
    createMessage("assistant", "Hi there! How can I help?")
  ]);
  const [history, setHistory] = useState([]);

  const messageListRef = useRef(null);
  const textAreaRef = useRef(null);

  // Auto scroll chat to bottom
  useEffect(() => {
    const messageList = messageListRef.current;
    if (messageList) {
      messageList.scrollTop = messageList.scrollHeight;
    }
  }, [messages]);

  // Focus on text field on load
  useEffect(() => {
    textAreaRef.current?.focus?.();
  }, []);

  useEffect(() => {
    setHistory((prevHistory) => {
      const nextHistory = computeHistoryPairs(messages);
      if (
        prevHistory.length === nextHistory.length &&
        prevHistory.every(
          (pair, index) =>
            pair[0] === nextHistory[index]?.[0] &&
            pair[1] === nextHistory[index]?.[1]
        )
      ) {
        return prevHistory;
      }
      return nextHistory;
    });
  }, [messages]);

  // Handle errors
  const handleError = (message = "Oops! There seems to be an error. Please try again.") => {
    setMessages((prevMessages) => {
      if (!prevMessages.length) {
        return [createMessage("assistant", message)];
      }

      const updated = [...prevMessages];
      const lastIndex = updated.length - 1;
      if (messageRole(updated[lastIndex]) === "assistant" && !updated[lastIndex].content) {
        updated[lastIndex] = { ...updated[lastIndex], content: message };
      } else {
        updated.push(createMessage("assistant", message));
      }
      return updated;
    });
    setLoading(false);
    setUserInput("");
  }

  // Handle form submission
  const handleSubmit = async (e) => {
    e.preventDefault();

    if (userInput.trim() === "") {
      return;
    }

    setLoading(true);
    const userQuestion = userInput;
    const userMessage = createMessage("user", userQuestion);
    const assistantPlaceholder = createMessage("assistant", "");
    const context = [...messages, userMessage];
    const optimisticMessages = [...context, assistantPlaceholder];
    setMessages(optimisticMessages);

    // Send chat history to API
    try {
      const historyPayload = history.length ? history : computeHistoryPairs(messages);
      let endpoint = "/api/chat";
      if (responseMode === "sse") {
        endpoint += "?sse=1";
      } else if (responseMode === "json") {
        endpoint += "?mode=json";
      }

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: context.map(({ role, content }) => ({ role, content })),
          history: historyPayload,
          question: userQuestion,
        }),
      });

      // Reset user input
      setUserInput("");

      if (!response.ok || !response.body) {
        const errorText = await response.text();
        console.error("Chat request failed", errorText);
        handleError();
        return;
      }

      const contentType = response.headers.get("content-type") || "";
      let assistantContent = "";
      let sawDone = false;

      const updateAssistantMessage = (content) => {
        setMessages((prevMessages) => {
          if (!prevMessages.length) return prevMessages;
          const updated = [...prevMessages];
          const lastIndex = updated.length - 1;
          if (messageRole(updated[lastIndex]) === "assistant") {
            updated[lastIndex] = { ...updated[lastIndex], content };
          }
          return updated;
        });
      };

      if (contentType.includes("application/json")) {
        const dataText = await response.text();
        let payload;
        try {
          payload = dataText ? JSON.parse(dataText) : null;
        } catch (error) {
          console.error("Failed to parse JSON response", { error, dataText });
          handleError();
          return;
        }

        const jsonMessage =
          payload?.result?.content ??
          payload?.result ??
          payload?.message?.content ??
          payload?.raw?.message?.content ??
          payload?.raw?.response ??
          "";

        if (jsonMessage) {
          assistantContent = jsonMessage;
          updateAssistantMessage(assistantContent);
        } else {
          console.warn("Empty JSON response", payload);
          handleError();
          return;
        }
      } else {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() ?? "";

          for (const rawLine of lines) {
            const trimmed = rawLine.trim();
            if (!trimmed || trimmed === "event: end") continue;

            let payloadText = trimmed;
            if (payloadText.startsWith("data:")) {
              payloadText = payloadText.slice(5).trim();
            }
            if (!payloadText || payloadText === "[DONE]") continue;

            try {
              const payload = JSON.parse(payloadText);
              if (payload.error) {
                console.error("Ollama error", payload.error);
                handleError();
                return;
              }
              const chunk = payload.message?.content ?? "";
              if (chunk) {
                assistantContent += chunk;
                updateAssistantMessage(assistantContent);
              }
              if (payload.done) {
                sawDone = true;
              }
            } catch (error) {
              console.error("Failed to parse stream chunk", {
                line: payloadText,
                error,
              });
            }
          }
        }

        if (buffer.trim()) {
          let payloadText = buffer.trim();
          if (payloadText.startsWith("data:")) {
            payloadText = payloadText.slice(5).trim();
          }
          if (payloadText && payloadText !== "[DONE]") {
            try {
              const payload = JSON.parse(payloadText);
              if (payload.message?.content) {
                assistantContent += payload.message.content;
                updateAssistantMessage(assistantContent);
              }
              if (payload.done) {
                sawDone = true;
              }
            } catch (error) {
              console.error("Failed to parse trailing stream chunk", {
                buffer: payloadText,
                error,
              });
            }
          }
        }
      }

      setLoading(false);

      if (!assistantContent) {
        handleError();
        return;
      }

      if (!sawDone) {
        setMessages((prevMessages) => {
          if (!prevMessages.length) return prevMessages;
          const updated = [...prevMessages];
          const lastIndex = updated.length - 1;
          if (messageRole(updated[lastIndex]) === "assistant") {
            updated[lastIndex] = {
              ...updated[lastIndex],
              content: assistantContent,
            };
          }
          return updated;
        });
      }
    } catch (error) {
      console.error("Chat request failed", error);
      handleError();
    }

  };

  // Prevent blank submissions and allow for multiline input
  const handleEnter = (e) => {
    if (e.key === "Enter" && userInput) {
      if (!e.shiftKey && userInput) {
        handleSubmit(e);
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
    }
  };

  return (
    <>
      <Head>
        <title>PopPooB</title>
        <meta name="description" content="GPT-4 interface" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <div className={styles.topnav}>
        <div className={styles.navlogo}>
          <a href="/">PopPooB</a>
        </div>
        <div className={styles.navlinks}>
        </div>
      </div>
      <main className={styles.main}>
        <div className={styles.cloud}>
          <div ref={messageListRef} className={styles.messagelist}>
            {messages.map((message, index) => {
              const role = messageRole(message);
              return (
                // The latest message sent by the user will be animated while waiting for a response
                <div
                  key={index}
                  className={
                    role === "user" && loading && index === messages.length - 1
                      ? styles.usermessagewaiting
                      : role === "assistant"
                      ? styles.apimessage
                      : styles.usermessage
                  }
                >
                  {/* Display the correct icon depending on the message type */}
                  {role === "assistant" ? (
                    <Image src="/openai.png" alt="AI" width="30" height="30" className={styles.boticon} priority={true} />
                  ) : (
                    <Image src="/usericon.png" alt="Me" width="30" height="30" className={styles.usericon} priority={true} />
                  )}
                  <div className={styles.markdownanswer}>
                    {/* Messages are being rendered in Markdown format */}
                    <ReactMarkdown linkTarget={"_blank"}>{message.content}</ReactMarkdown>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
        <div className={styles.center}>

          <div className={styles.cloudform}>
            <form onSubmit={handleSubmit}>
              <div className={styles.modeswitcher}>
                <label htmlFor="responseMode">Response mode:</label>
                <select
                  id="responseMode"
                  className={styles.modeselect}
                  value={responseMode}
                  onChange={(event) => setResponseMode(event.target.value)}
                  disabled={loading}
                >
                  <option value="stream">Stream (NDJSON)</option>
                  <option value="sse">Stream (SSE)</option>
                  <option value="json">JSON (no streaming)</option>
                </select>
              </div>
              <textarea
                disabled={loading}
                onKeyDown={handleEnter}
                ref={textAreaRef}
                autoFocus={false}
                rows={1}
                maxLength={5128}
                type="text"
                id="userInput"
                name="userInput"
                placeholder={loading ? "Waiting for response..." : "Type your question..."}
                value={userInput}
                onChange={e => setUserInput(e.target.value)}
                className={styles.textarea}
              />
              <button
                type="submit"
                disabled={loading}
                className={styles.generatebutton}
              >
                {loading ? <div className={styles.loadingwheel}><CircularProgress color="inherit" size={20} /> </div> :
                  // Send icon SVG in input field
                  <svg viewBox='0 0 20 20' className={styles.svgicon} xmlns='http://www.w3.org/2000/svg'>
                    <path d='M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z'></path>
                  </svg>}
              </button>
            </form>
          </div>
          <div className={styles.footer}>
            <p>Powered by <a href="https://poppoob.com/about" target="_blank">PopPooB</a>.</p>
          </div>
        </div>
      </main>
    </>
  )
}
