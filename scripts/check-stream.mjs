import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const source = await readFile(
  new URL("../lib/translation-stream.ts", import.meta.url),
  "utf8",
);
const code = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
  },
}).outputText;
const { readEventStream } = await import(
  "data:text/javascript;base64," + Buffer.from(code).toString("base64")
);
const base = process.env.TEST_URL || "http://127.0.0.1:5173";
const sign = await fetch(base + "/signin-with-chatgpt?return_to=/", {
  redirect: "manual",
});
const cookie = sign.headers.get("set-cookie")?.split(";")[0];
const ids = [crypto.randomUUID(), crypto.randomUUID()];
const response = await fetch(base + "/api/translate/segments", {
  method: "POST",
  headers: { "Content-Type": "application/json", Cookie: cookie },
  body: JSON.stringify({
    fragments: ids.map((id, i) => ({
      id,
      text: i
        ? "The integers are contained in the rational numbers."
        : "The natural numbers are contained in the integers.",
    })),
    force: true,
    stream: true,
    thinking: true,
    thinkingControl: true,
  }),
  signal: AbortSignal.timeout(180000),
});
assert.equal(response.status, 200);
assert.ok(response.headers.get("content-type").includes("text/event-stream"));
let result;
let progress = 0,
  thinking = false;
await readEventStream(response, (raw) => {
  const event = JSON.parse(raw);
  assert.notEqual(event.type, "error", event.error);
  if (event.type === "progress") {
    progress++;
    thinking ||= event.thinking;
  }
  if (event.type === "result") result = event.data;
});
assert.ok(progress > 0);
assert.ok(thinking);
assert.deepEqual(
  result.groups.flatMap((g) => g.ids),
  ids,
);
assert.ok(result.groups.every((g) => g.translation));
console.log(
  "PASS real DeepSeek thinking + streamed progress + validated semantic translation",
);
