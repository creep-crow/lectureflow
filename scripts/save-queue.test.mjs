import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const compiled = ts.transpileModule(
  await readFile(new URL("../lib/save-queue.ts", import.meta.url), "utf8"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } },
).outputText;
const { drainSaves } = await import(
  "data:text/javascript;base64," + Buffer.from(compiled).toString("base64")
);

test("Post-edit waits for a newer initial draft after joining an older raw-text save", async () => {
  const draft = { chinese: "初译", translation_group: [] };
  const queue = new Map([["a", draft]]);
  let inFlight = true, calls = 0;
  const saved = await drainSaves(
    () => queue,
    async () => {
      calls++;
      if (inFlight) {
        inFlight = false; // Old raw-text response cannot remove the queued draft.
        return true;
      }
      assert.equal(queue.get("a"), draft);
      queue.delete("a");
      return true;
    },
    () => inFlight,
    new Set(["a"]),
  );
  assert.equal(saved, true);
  assert.equal(calls, 2);
  assert.equal(queue.size, 0);
});

test("Draining handles multiple batches and does not drop a draft replaced during saving", async () => {
  const queue = new Map(Array.from({ length: 105 }, (_, i) => [String(i), { version: 1 }]));
  let calls = 0;
  const versions = [];
  const saved = await drainSaves(() => queue, async () => {
    const batch = [...queue].slice(0, 50);
    if (++calls === 1) queue.set("104", { version: 2 });
    for (const [id, value] of batch) {
      versions.push([id, value.version]);
      if (queue.get(id) === value) queue.delete(id);
    }
    return true;
  }, () => false, new Set(["104"]));
  assert.equal(saved, true);
  assert.equal(calls, 3);
  assert.deepEqual(versions.at(-1), ["104", 2]);
});

test("Failed saves retain drafts and stop draining without committing a post-edit", async () => {
  const draft = { chinese: "保留初译" };
  const queue = new Map([["a", draft]]);
  let calls = 0;
  assert.equal(await drainSaves(() => queue, async () => {
    calls++;
    return false;
  }, () => false), false);
  assert.equal(calls, 1);
  assert.equal(queue.get("a"), draft);
});

test("A fresh request without queue progress stops safely; unrelated pending saves do not block a target", async () => {
  const queue = new Map([["other", {}]]);
  let calls = 0;
  const flush = async () => { calls++; return true; };
  assert.equal(await drainSaves(() => queue, flush, () => false, new Set(["saved"])), true);
  assert.equal(calls, 0);
  assert.equal(await drainSaves(() => queue, flush, () => false), false);
  assert.equal(calls, 1);
});
