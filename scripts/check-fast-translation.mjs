import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const compiled = ts.transpileModule(
  await readFile(
    new URL("../lib/translation-stream.ts", import.meta.url),
    "utf8",
  ),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  },
).outputText;
const { readEventStream } = await import(
  "data:text/javascript;base64," + Buffer.from(compiled).toString("base64")
);
const base = process.env.TEST_URL || "http://127.0.0.1:5173";
assert.ok(
  new URL(base).hostname === "127.0.0.1",
  "This script creates a disposable local-only classroom",
);
const sign = await fetch(base + "/signin-with-chatgpt?return_to=/", {
  redirect: "manual",
});
const cookie = sign.headers.get("set-cookie")?.split(";")[0];
async function request(path, payload) {
  const response = await fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(180000),
  });
  assert.equal(response.status, path === "/api/classrooms" ? 201 : 200);
  if (!response.headers.get("content-type").includes("text/event-stream"))
    return response.json();
  let data,
    progress = 0;
  await readEventStream(response, (raw) => {
    const event = JSON.parse(raw);
    assert.notEqual(event.type, "error", event.error);
    if (event.type === "progress") progress++;
    if (event.type === "result") data = event.data;
  });
  assert.ok(progress > 0);
  assert.ok(data);
  return data;
}
const fragments = [
  { id: crypto.randomUUID(), text: "Integers were introduced because" },
  {
    id: crypto.randomUUID(),
    text: "the equation x + 1 = 0 cannot be solved using only natural numbers.",
  },
];
const context = [];
const drafts = [];
const timings = [];
for (const fragment of fragments) {
  const began = performance.now();
  const result = await request("/api/translate", {
    text: fragment.text,
    context: JSON.stringify(context),
    stream: true,
  });
  assert.ok(result.translation.trim());
  timings.push(Math.round(performance.now() - began));
  drafts.push({
    id: fragment.id,
    ids: [fragment.id],
    translation: result.translation,
  });
  context.push({ english: fragment.text, chinese: result.translation });
}
console.log(
  "PASS immediate unfinished-clause translation and bilingual context, SSE enabled",
  { initialRequestMs: timings },
);
const c = await request("/api/classrooms", {
  title: "验证课堂 · 数系的扩展（本地测试）",
});
const rows = fragments.map((f, i) => ({
  id: f.id,
  english: f.text,
  chinese: drafts[i].translation,
  offset_ms: i * 2000,
  translation_group: [],
}));
await request("/api/classrooms/" + c.id + "/segments", { segments: rows });
const post = await request("/api/translate/segments", {
  fragments,
  drafts,
  context: "[]",
  force: true,
  stream: true,
});
assert.deepEqual(
  post.groups.flatMap((g) => g.ids),
  fragments.map((f) => f.id),
);
assert.equal(
  post.groups.length,
  1,
  "because-clause should be stitched after initial translation",
);
await request("/api/classrooms/" + c.id + "/refine", {
  expected: rows.map((r) => ({
    id: r.id,
    chinese: r.chinese,
    translation_group: [],
  })),
  groups: post.groups,
});
const saved = await fetch(base + "/api/classrooms/" + c.id, {
  headers: { Cookie: cookie },
}).then((r) => r.json());
assert.equal(saved.segments[0].chinese, post.groups[0].translation);
assert.equal(saved.segments[1].chinese, "");
assert.deepEqual(
  saved.segments.map((r) => r.english),
  fragments.map((f) => f.text),
);
console.log(
  "PASS real post-editing stitches completed translations and persists original sources",
  { fixtureClassroom: c.id },
);
