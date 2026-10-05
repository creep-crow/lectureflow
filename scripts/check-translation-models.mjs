import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
const base = process.env.TEST_URL || "http://127.0.0.1:5173";
const sign = await fetch(base + "/signin-with-chatgpt?return_to=/", {
  redirect: "manual",
});
const cookie = sign.headers.get("set-cookie")?.split(";")[0];
const keys = parseEnv(
  await readFile(new URL("../.env", import.meta.url), "utf8"),
);
async function call(path, data, key) {
  const r = await fetch(base + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
      ...(key ? { "x-translation-key": key } : {}),
    },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(55000),
  });
  const result = await r.json();
  assert.equal(r.status, 200, result.error);
  return result;
}
const ds = await call("/api/translate/models", {
  protocol: "deepseek",
  baseUrl: "https://api.deepseek.com",
});
assert.ok(ds.models.includes("deepseek-flash"));
console.log("PASS default DeepSeek model discovery: " + ds.models.join(", "));
const oai = await call(
  "/api/translate/models",
  {
    protocol: "openai",
    baseUrl: "https://api.deepseek.com/v1/chat/completions",
  },
  keys.DEEPSEEK_API_KEY,
);
assert.ok(oai.models.includes("deepseek-flash"));
console.log("PASS custom OpenAI-compatible model discovery with supplied key");
const fragments = [
  {
    id: crypto.randomUUID(),
    text: "The natural numbers are contained in the integers.",
  },
  {
    id: crypto.randomUUID(),
    text: "The integers are contained in the rational numbers.",
  },
];
const translated = await call(
  "/api/translate/segments",
  {
    protocol: "openai",
    baseUrl: "https://api.deepseek.com/v1/chat/completions",
    model: "deepseek-flash",
    fragments,
    force: true,
  },
  keys.DEEPSEEK_API_KEY,
);
assert.equal(translated.groups.flatMap((g) => g.ids).length, 2);
assert.ok(translated.groups.every((g) => g.translation));
console.log(
  "PASS real OpenAI-compatible semantic translation using explicit complete DeepSeek endpoint",
);
