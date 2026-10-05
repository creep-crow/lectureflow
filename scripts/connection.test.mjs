import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
async function moduleAt(path) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  }).outputText;
  return import(
    "data:text/javascript;base64," + Buffer.from(code).toString("base64")
  );
}
const { TranslationKeyPool } = await moduleAt("../lib/translation-key-pool.ts");
const {
  readConnectionSettings,
  saveConnectionSettings,
  clearConnectionSettings,
  translationKeys,
} = await moduleAt("../lib/connection-preferences.ts");
const defaults = {
  geminiKey: "",
  deepseekKey: "",
  translationKeys: [],
  translationConcurrency: 2,
  translationStream: false,
  translationThinking: false,
  translationThinkingControl: false,
  translationUrl: "https://api.deepseek.com",
  translationProtocol: "deepseek",
  liveModel: "live",
  translationModel: "text",
  deviceId: "",
  mode: "live",
  chunkModel: "chunks",
};
function storage() {
  const values = new Map();
  return {
    getItem: (k) => values.get(k) || null,
    setItem: (k, v) => values.set(k, v),
    removeItem: (k) => values.delete(k),
  };
}
const delay = () => new Promise((resolve) => setTimeout(resolve, 2));

test("Browser preferences survive a fresh read, preserve OpenAI endpoint, and can clear all secrets", () => {
  const local = storage();
  const saved = {
    ...defaults,
    geminiKey: "gemini-test",
    deepseekKey: "first-test",
    translationKeys: ["second-test"],
    translationConcurrency: 4,
    translationProtocol: "openai",
    translationUrl: "https://relay.example.com/v1/chat/completions",
  };
  saveConnectionSettings(local, saved);
  assert.deepEqual(readConnectionSettings(local, defaults), saved);
  assert.deepEqual(
    translationKeys({
      ...saved,
      translationKeys: ["first-test", " second-test ", ""],
    }),
    ["first-test", "second-test"],
  );
  clearConnectionSettings(local);
  assert.deepEqual(readConnectionSettings(local, defaults), defaults);
});
test("Malformed stored preferences cannot add unknown fields, invalid protocols or unbounded concurrency", () => {
  const local = storage();
  saveConnectionSettings(local, {
    ...defaults,
    translationProtocol: "bad",
    mode: "bad",
    translationConcurrency: 999,
    translationKeys: [1, "ok", "bad\nkey"],
    unknown: "ignored",
  });
  const loaded = readConnectionSettings(local, defaults);
  assert.equal(loaded.translationProtocol, "deepseek");
  assert.equal(loaded.mode, "live");
  assert.equal(loaded.translationConcurrency, 2);
  assert.equal(loaded.unknown, undefined);
  assert.deepEqual(loaded.translationKeys, ["ok"]);
  const broken = { ...local, getItem: () => "{not-json" };
  assert.deepEqual(readConnectionSettings(broken, defaults), defaults);
  assert.throws(() =>
    saveConnectionSettings(
      {
        setItem() {
          throw new Error("blocked");
        },
      },
      defaults,
    ),
  );
});
test("Pasted newline, comma and Chinese comma keys survive refresh and are deduplicated before headers", () => {
  const local = storage();
  const settings = {
    ...defaults,
    deepseekKey: " first-key, second-key\r\nthird-key，first-key\n",
    translationKeys: [],
    translationStream: true,
    translationThinking: true,
    translationThinkingControl: true,
  };
  saveConnectionSettings(local, settings);
  const loaded = readConnectionSettings(local, defaults);
  assert.equal(loaded.deepseekKey, settings.deepseekKey);
  assert.equal(loaded.translationStream, true);
  assert.equal(loaded.translationThinking, true);
  assert.deepEqual(translationKeys(loaded), [
    "first-key",
    "second-key",
    "third-key",
  ]);
  assert.ok(translationKeys(loaded).every((k) => !/[\r\n,，]/.test(k)));
});
test("Idle keys rotate evenly and duplicate keys do not increase concurrency", async () => {
  const pool = new TranslationKeyPool(["a", "b", "c", "a"], 6);
  assert.equal(pool.concurrency, 3);
  const seen = [];
  for (let i = 0; i < 9; i++)
    await pool.run(async (key) => {
      seen.push(key);
    });
  for (const key of ["a", "b", "c"])
    assert.equal(seen.filter((k) => k === key).length, 3);
  assert.equal(new TranslationKeyPool(["same", "same"], 6).concurrency, 1);
  assert.equal(await new TranslationKeyPool([], 6).run(async (key) => key), "");
});
test("Queued jobs respect the configured global limit and never share an active key", async () => {
  const pool = new TranslationKeyPool(["a", "b", "c"], 2);
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const active = new Set();
  let peak = 0;
  let started = 0;
  const jobs = Array.from({ length: 6 }, () =>
    pool.run(async (key) => {
      assert.ok(!active.has(key));
      active.add(key);
      started++;
      peak = Math.max(peak, active.size);
      await gate;
      await delay();
      active.delete(key);
      return key;
    }),
  );
  await delay();
  assert.equal(started, 2);
  release();
  await Promise.all(jobs);
  assert.equal(peak, 2);
  assert.equal(started, 6);
});
test("Rate-limit failure switches keys, cools the failed key, and does not retry permanent app errors", async () => {
  const pool = new TranslationKeyPool(["bad", "good"], 2);
  const seen = [];
  const result = await pool.run(async (key) => {
    seen.push(key);
    if (key === "bad")
      throw Object.assign(new Error("limited"), { status: 429 });
    return "translated";
  });
  assert.equal(result, "translated");
  assert.deepEqual(seen, ["bad", "good"]);
  assert.equal(await pool.run(async (key) => key), "good");
  let tries = 0;
  await assert.rejects(
    pool.run(async () => {
      tries++;
      throw Object.assign(new Error("sign in"), { status: 401 });
    }),
    /sign in/,
  );
  assert.equal(tries, 1);
});
test("All-key failure is bounded and cooled keys fail promptly without losing the caller's task", async () => {
  const pool = new TranslationKeyPool(["a", "b", "c", "d"], 4);
  let attempts = 0;
  await assert.rejects(
    pool.run(async () => {
      attempts++;
      throw Object.assign(new Error("offline"), { status: 502 });
    }),
    /offline/,
  );
  assert.equal(attempts, 3);
  await assert.rejects(
    pool.run(async () => {
      throw Object.assign(new Error("last key"), { status: 429 });
    }),
  );
  await assert.rejects(
    pool.run(async () => "never"),
    /密钥/,
  );
});
