import WebSocket from "ws";
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
const { GEMINI_API_KEY } = parseEnv(
  await readFile(new URL("../.env", import.meta.url), "utf8"),
);
const base = "http://127.0.0.1:5173";
const sign = await fetch(base + "/signin-with-chatgpt?return_to=/", {
  redirect: "manual",
});
const cookie = sign.headers.get("set-cookie")?.split(";")[0];
const response = await fetch(base + "/api/gemini/token", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Cookie: cookie,
    "x-gemini-key": GEMINI_API_KEY,
  },
  body: JSON.stringify({ model: "gemini-3.5-transcribe-live" }),
});
const session = await response.json();
if (!response.ok) throw new Error(session.error);
console.log("Token API version:", session.apiVersion);
const wav = await readFile(
  new URL("../.sites-runtime/test-lecture.wav", import.meta.url),
);
let pcm;
for (let p = 12; p + 8 < wav.length; ) {
  const n = wav.readUInt32LE(p + 4);
  if (wav.toString("ascii", p, p + 4) === "data") {
    pcm = wav.subarray(p + 8, p + 8 + n);
    break;
  }
  p += 8 + n + (n % 2);
}
if (!pcm) throw new Error("PCM chunk missing");
let text = "",
  sent = false;
await new Promise((resolve, reject) => {
  const ws = new WebSocket(
    "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=" +
      encodeURIComponent(session.token),
  );
  const timeout = setTimeout(() => {
    ws.close();
    reject(new Error("Live transcription timed out"));
  }, 30000);
  ws.onopen = () => {
    console.log("Live socket open");
    ws.send(
      JSON.stringify({
        setup: {
          model: "models/" + session.model,
          generationConfig: { responseModalities: ["TEXT"] },
          inputAudioTranscription: { languageCodes: ["en-US"] },
        },
      }),
    );
  };
  ws.onmessage = async (event) => {
    const m = JSON.parse(
      typeof event.data === "string"
        ? event.data
        : Buffer.isBuffer(event.data)
          ? event.data.toString()
          : await event.data.text(),
    );
    if (m.setupComplete && !sent) {
      console.log("Live setup confirmed; sending PCM");
      sent = true;
      void (async () => {
        await new Promise((r) => setTimeout(r, 150));
        for (let p = 0; p < pcm.length && ws.readyState === 1; p += 3200) {
          ws.send(
            JSON.stringify({
              realtimeInput: {
                audio: {
                  mimeType: "audio/pcm;rate=16000",
                  data: pcm.subarray(p, p + 3200).toString("base64"),
                },
              },
            }),
          );
          await new Promise((r) => setTimeout(r, 100));
        }
        if (ws.readyState === 1)
          ws.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
      })();
    }
    if (m.serverContent?.inputTranscription?.text) {
      text += m.serverContent.inputTranscription.text + " ";
      console.log(
        "Confirmed transcript:",
        m.serverContent.inputTranscription.text,
      );
      if (/training set/i.test(text)) {
        clearTimeout(timeout);
        ws.close();
        resolve();
      }
    }
    if (m.error) {
      clearTimeout(timeout);
      ws.close();
      reject(new Error("Gemini returned an error"));
    }
  };
  ws.onerror = (e) => {
    console.log(
      "Live transport error:",
      String(e.error?.message || e.message || "unknown").replaceAll(
        session.token,
        "[REDACTED]",
      ),
    );
  };
  ws.onclose = (e) => {
    console.log(
      "Live closed:",
      e.code,
      String(e.reason).replaceAll(session.token, "[REDACTED]"),
    );
    clearTimeout(timeout);
    if (/supervised learning/i.test(text)) resolve();
    else reject(new Error("Live closed before speech was transcribed"));
  };
});
if (!/supervised learning/i.test(text))
  throw new Error("Expected speech not transcribed");
console.log(
  "PASS real Gemini audio stream recognized synthesized classroom speech.",
);
