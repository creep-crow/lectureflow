import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const source = await readFile(
  new URL("../lib/semantic-translation.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
  },
}).outputText;
const { SemanticTranslator, validateGroups, displaySegments } = await import(
  "data:text/javascript;base64," + Buffer.from(compiled).toString("base64")
);
const fragments = [
  { id: "a", text: "And, you know, if" },
  {
    id: "b",
    text: "you look at why these things were thought up, they were thought up to solve, you know",
  },
  {
    id: "c",
    text: "polynomial equations you couldn't solve in the number system before. Uh",
  },
];
const delay = (ms = 12) => new Promise((r) => setTimeout(r, ms));

test("Semantic output may defer a tail, but must never skip, repeat or invent source IDs", () => {
  assert.equal(validateGroups(fragments, []), 0);
  assert.equal(
    validateGroups(fragments, [{ ids: ["a", "b"], translation: "翻译" }]),
    2,
  );
  assert.throws(() =>
    validateGroups(fragments, [{ ids: ["b"], translation: "x" }]),
  );
  assert.throws(() =>
    validateGroups(fragments, [{ ids: ["a", "a"], translation: "x" }]),
  );
  assert.throws(() =>
    validateGroups(fragments, [{ ids: ["a", "unknown"], translation: "x" }]),
  );
  assert.throws(() => validateGroups(fragments, [], true));
});

test("A speech pause keeps an unfinished clause available for the following explanation", async () => {
  const calls = [],
    groups = [];
  const translator = new SemanticTranslator(
    {
      request: async (rows, force) => {
        calls.push({ rows, force });
        return rows.length < 3
          ? []
          : [
              {
                ids: rows.map((r) => r.id),
                translation:
                  "这些数系是为了解决此前无法求解的多项式方程而提出的。",
              },
            ];
      },
      onGroup: (g) => groups.push(g),
      onPending() {},
      onError: (e) => {
        throw new Error(e);
      },
    },
    { debounce: 1, maxWait: 1000 },
  );
  try {
    translator.append(fragments[0]);
    await delay();
    assert.equal(groups.length, 0);
    translator.append(fragments[1]);
    translator.append(fragments[2]);
    await delay();
    assert.deepEqual(groups[0].ids, ["a", "b", "c"]);
    assert.equal(calls.at(-1).force, false);
  } finally {
    translator.dispose();
  }
});

test("Fragments arriving during a request are included in the next semantic decision", async () => {
  let release;
  const gate = new Promise((r) => {
    release = r;
  });
  const calls = [],
    groups = [];
  const translator = new SemanticTranslator(
    {
      request: async (rows) => {
        calls.push(rows);
        if (calls.length === 1) {
          await gate;
          return [];
        }
        return [{ ids: rows.map((r) => r.id), translation: "完整译文" }];
      },
      onGroup: (g) => groups.push(g),
      onPending() {},
      onError() {},
    },
    { debounce: 1, maxWait: 1000 },
  );
  try {
    translator.append(fragments[0]);
    await delay();
    translator.append(fragments[1]);
    translator.append(fragments[2]);
    release();
    await delay();
    assert.deepEqual(groups[0].ids, ["a", "b", "c"]);
    assert.equal(calls.length, 2);
  } finally {
    translator.dispose();
  }
});

test("Stop translates the remaining tail once; failed requests can be retried without losing text", async () => {
  let fail = true;
  const groups = [],
    errors = [],
    counts = [];
  const translator = new SemanticTranslator({
    request: async (rows, force) => {
      assert.ok(force);
      if (fail) throw new Error("Network unavailable");
      return [{ ids: rows.map((r) => r.id), translation: "尚未说完的句尾……" }];
    },
    onGroup: (g) => groups.push(g),
    onPending: (n) => counts.push(n),
    onError: (e) => errors.push(e),
  });
  try {
    translator.append(fragments[0]);
    await translator.finish();
    assert.equal(errors.length, 1);
    assert.equal(counts.at(-1), 0);
    assert.ok(translator.has("a"));
    fail = false;
    await Promise.all([translator.finish(), translator.finish()]);
    assert.equal(groups.length, 1);
    assert.ok(!translator.has("a"));
  } finally {
    translator.dispose();
  }
});

test("A prolonged pause has a bounded wait, rather than withholding translation forever", async () => {
  const forces = [];
  const translator = new SemanticTranslator(
    {
      request: async (rows, force) => {
        forces.push(force);
        return force
          ? [{ ids: rows.map((r) => r.id), translation: "未完句……" }]
          : [];
      },
      onGroup() {},
      onPending() {},
      onError() {},
    },
    { debounce: 1, maxWait: 30 },
  );
  try {
    translator.append(fragments[0]);
    await delay(65);
    assert.deepEqual(forces, [false, true]);
  } finally {
    translator.dispose();
  }
});

test("Disposing a classroom prevents late results from mutating the next classroom", async () => {
  let release;
  const gate = new Promise((r) => {
    release = r;
  });
  const groups = [];
  const translator = new SemanticTranslator(
    {
      request: async (rows) => {
        await gate;
        return [{ ids: rows.map((r) => r.id), translation: "旧课堂" }];
      },
      onGroup: (g) => groups.push(g),
      onPending() {},
      onError() {},
    },
    { debounce: 1, maxWait: 1000 },
  );
  translator.append(fragments[0]);
  await delay();
  translator.dispose();
  release();
  await delay();
  assert.deepEqual(groups, []);
});

test("Persisted grouping restores coherent display and retains every original word/timestamp", () => {
  const raw = fragments.map((f, i) => ({
    id: f.id,
    english: f.text,
    chinese: i === 0 ? "中文整句" : "",
    offset_ms: 61000 + i * 5000,
    ...(i === 0 ? { translation_group: ["a", "b", "c"] } : {}),
  }));
  const snapshot = JSON.stringify(raw);
  const visible = displaySegments(JSON.parse(snapshot));
  assert.equal(visible.length, 1);
  assert.equal(visible[0].english, fragments.map((f) => f.text).join(" "));
  assert.equal(visible[0].offset_ms, 61000);
  assert.equal(JSON.stringify(raw), snapshot);
  assert.equal(
    displaySegments(raw.slice(0, 2)).length,
    2,
    "incomplete pages must not hide unseen sources",
  );
});

test("Backlog windows translate concurrently but publish in source order", async () => {
  const rows = Array.from({ length: 45 }, (_, i) => ({
    id: `s${i}`,
    text: `Sentence ${i}.`,
  }));
  const groups = [];
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let active = 0,
    peak = 0;
  const translator = new SemanticTranslator({
    concurrency: () => 2,
    request: async (batch, force) => {
      assert.ok(force);
      active++;
      peak = Math.max(peak, active);
      if (batch[0].id === "s0") await gate;
      active--;
      return [{ ids: batch.map((f) => f.id), translation: "完整译文" }];
    },
    onGroup: (g) => groups.push(g),
    onPending() {},
    onError: (e) => {
      throw new Error(e);
    },
  });
  try {
    rows.forEach((f) => translator.append(f));
    const finish = translator.finish();
    await delay();
    assert.equal(peak, 2);
    assert.equal(groups.length, 0);
    release();
    await finish;
    assert.deepEqual(
      groups.flatMap((g) => g.ids),
      rows.map((f) => f.id),
    );
    assert.ok(!translator.has("s44"));
  } finally {
    translator.dispose();
  }
});
test("A failed parallel window remains retryable without duplicating a successful window", async () => {
  const rows = Array.from({ length: 40 }, (_, i) => ({
    id: `r${i}`,
    text: `Sentence ${i}.`,
  }));
  const groups = [],
    errors = [];
  let fail = true;
  const translator = new SemanticTranslator({
    concurrency: () => 2,
    request: async (batch) => {
      if (fail && batch[0].id === "r0") throw new Error("offline");
      return [{ ids: batch.map((f) => f.id), translation: "译文" }];
    },
    onGroup: (g) => groups.push(g),
    onPending() {},
    onError: (error, ids) => errors.push({ error, ids }),
  });
  try {
    rows.forEach((f) => translator.append(f));
    await translator.finish();
    assert.equal(errors.length, 1);
    assert.ok(translator.has("r0"));
    assert.ok(!translator.has("r20"));
    fail = false;
    await translator.finish();
    const all = groups.flatMap((g) => g.ids);
    assert.equal(all.length, 40);
    assert.equal(new Set(all).size, 40);
    assert.ok(!translator.has("r0"));
  } finally {
    translator.dispose();
  }
});
