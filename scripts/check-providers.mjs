import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
const keys = parseEnv(
  await readFile(new URL("../.env", import.meta.url), "utf8"),
);
const base = process.env.TEST_URL || "http://127.0.0.1:5173";
const sign = await fetch(base + "/signin-with-chatgpt?return_to=/", {
  redirect: "manual",
});
const cookie = sign.headers.get("set-cookie")?.split(";")[0];
const gemini = await fetch(base + "/api/gemini/token", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Cookie: cookie,
    "x-gemini-key": keys.GEMINI_API_KEY,
  },
  body: JSON.stringify({ model: "gemini-3.5-transcribe-live" }),
});
const token = await gemini.json();
console.log(
  "Gemini token endpoint:",
  gemini.status,
  token.error || "ephemeral token received",
);
if (gemini.ok) {
  await new Promise((resolve) => {
    const socket = new WebSocket(
      "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=" +
        encodeURIComponent(token.token),
    );
    const timer = setTimeout(() => {
      console.log("Gemini live setup: timed out");
      socket.close();
      resolve();
    }, 15000);
    socket.onopen = () =>
      socket.send(
        JSON.stringify({
          setup: {
            model: "models/" + token.model,
            generationConfig: { responseModalities: ["TEXT"] },
            inputAudioTranscription: { languageCodes: ["en-US"] },
          },
        }),
      );
    socket.onmessage = async (e) => {
      const data = JSON.parse(
        typeof e.data === "string" ? e.data : await e.data.text(),
      );
      if (data.setupComplete) {
        console.log("Gemini live setup: confirmed");
        clearTimeout(timer);
        socket.close();
        resolve();
      } else if (data.error) {
        console.log("Gemini live setup error code:", data.error.code);
        clearTimeout(timer);
        socket.close();
        resolve();
      }
    };
    socket.onerror = () => {
      console.log("Gemini live connection: network error");
      clearTimeout(timer);
      resolve();
    };
    socket.onclose = (e) => {
      console.log("Gemini live close code:", e.code);
      clearTimeout(timer);
      resolve();
    };
  });
} else {
  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models",
    {
      headers: { "x-goog-api-key": keys.GEMINI_API_KEY },
      signal: AbortSignal.timeout(20000),
    },
  );
  const data = await response.json();
  console.log("Gemini model-list status:", response.status);
  if (response.ok)
    console.log(
      "Gemini audio model names:",
      data.models
        ?.filter((m) => /live|audio|transcribe/.test(m.name))
        .map((m) => m.name),
    );
  else console.log("Gemini error category:", data.error?.status);
}
const audio = await readFile(
  new URL("../.sites-runtime/test-lecture.wav", import.meta.url),
).catch(() => null);
let speech = "In supervised learning, the model learns from labeled examples.";
if (audio) {
  const r = await fetch(base + "/api/gemini/transcribe", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
      "x-gemini-key": keys.GEMINI_API_KEY,
    },
    body: JSON.stringify({
      model: "gemini-3.5-transcribe",
      audio: audio.toString("base64"),
    }),
  });
  const d = await r.json();
  console.log(
    "Gemini chunk transcription endpoint:",
    r.status,
    d.error || d.text,
  );
  if (r.ok) speech = d.text;
}
const deepseek = await fetch(base + "/api/translate", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Cookie: cookie,
    "x-deepseek-key": keys.DEEPSEEK_API_KEY,
  },
  body: JSON.stringify({
    model: "deepseek-flash",
    text: speech,
    context: "An introductory machine learning lecture.",
  }),
});
const translated = await deepseek.json();
console.log(
  "DeepSeek translation endpoint:",
  deepseek.status,
  translated.error || translated.translation,
);
if (!deepseek.ok) {
  const r = await fetch("https://api.deepseek.com/models", {
    headers: { Authorization: "Bearer " + keys.DEEPSEEK_API_KEY },
    signal: AbortSignal.timeout(20000),
  });
  const d = await r.json();
  console.log("DeepSeek model-list status:", r.status);
  if (r.ok)
    console.log(
      "DeepSeek available models:",
      d.data?.map((m) => m.id),
    );
}
