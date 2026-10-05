import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const moduleUrl = (code) =>
  "data:text/javascript;base64," + Buffer.from(code).toString("base64");
async function compile(path) {
  return ts.transpileModule(
    await readFile(new URL(path, import.meta.url), "utf8"),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
      },
    },
  ).outputText;
}
const semanticUrl = moduleUrl(await compile("../lib/semantic-translation.ts"));
const { FastTranslator, completedContext, refinementWindow, applyRefinement } =
  await import(
    moduleUrl(
      (await compile("../lib/fast-translation.ts")).replace(
        'from "./semantic-translation"',
        "from " + JSON.stringify(semanticUrl),
      ),
    )
  );
const { displaySegments } = await import(semanticUrl);
const delay = () => new Promise((r) => setTimeout(r, 5));
function fixture(
  overrides = {},
  initial = [],
  timing = { debounce: 1000, maxWait: 2000 },
) {
  let rows = initial;
  const drafts = [],
    refines = [],
    errors = [],
    counts = [];
  const callbacks = {
    concurrency: () => 2,
    snapshot: () => rows,
    translate: async (f) => "初译" + f.id,
    refine: async (window) => {
      refines.push(window);
      return [
        {
          ids: window.fragments.map((f) => f.id),
          translation: "润色后的连贯译文",
        },
      ];
    },
    onDraft: (f, translation) => {
      drafts.push(f.id);
      rows = rows.map((r) =>
        r.id === f.id
          ? { ...r, chinese: translation, translation_group: [] }
          : r,
      );
    },
    onRefined: async (window, groups) => {
      rows = applyRefinement(rows, window.expected, groups);
    },
    onPending: (...values) => counts.push(values),
    onError: (...values) => errors.push(values),
    ...overrides,
  };
  const translator = new FastTranslator(callbacks, timing);
  return {
    translator,
    drafts,
    refines,
    errors,
    counts,
    rows: () => rows,
    setRows: (value) => { rows = value; },
    append(id, text = "And if") {
      rows = [
        ...rows,
        { id, english: text, chinese: "", offset_ms: rows.length * 1000 },
      ];
      translator.append({ id, text });
    },
  };
}
test("Unfinished fragments request immediately; completed drafts are visible before post-editing", async () => {
  let release;
  const gate = new Promise((r) => {
    release = r;
  });
  const calls = [];
  const f = fixture({
    translate: (fragment) => {
      calls.push(fragment);
      return gate;
    },
  });
  try {
    f.append("a");
    assert.equal(calls.length, 1, "no debounce or sentence-completion wait");
    assert.equal(calls[0].text, "And if");
    release("如果……");
    await delay();
    assert.equal(f.rows()[0].chinese, "如果……");
    assert.equal(f.refines.length, 0);
    await f.translator.finish();
    assert.equal(f.refines[0].drafts[0].translation, "如果……");
    assert.equal(f.rows()[0].chinese, "润色后的连贯译文");
  } finally {
    f.translator.dispose();
  }
});
test("Primary requests run concurrently and a quick later draft is not held behind a slower request", async () => {
  let release;
  const gate = new Promise((r) => {
    release = r;
  });
  let active = 0,
    peak = 0;
  const f = fixture({
    translate: async (fragment) => {
      active++;
      peak = Math.max(peak, active);
      if (fragment.id === "a") await gate;
      active--;
      return "译" + fragment.id;
    },
  });
  try {
    f.append("a");
    f.append("b");
    await delay();
    assert.equal(peak, 2);
    assert.equal(f.rows()[1].chinese, "译b");
    assert.equal(f.rows()[0].chinese, "");
    release();
    await f.translator.finish();
    assert.deepEqual(
      f.refines[0].fragments.map((r) => r.id),
      ["a", "b"],
    );
  } finally {
    release();
    f.translator.dispose();
  }
});
test("Later translations read completed bilingual sentences instead of only raw English", async () => {
  const contexts = [];
  const f = fixture({
    translate: async (fragment, context) => {
      contexts.push(context);
      return "术语译文" + fragment.id;
    },
  });
  try {
    f.append("a", "The natural numbers are contained in the integers.");
    await delay();
    f.append("b", "And these are contained in the rational numbers.");
    await f.translator.finish();
    assert.equal(contexts[1][0].chinese, "术语译文a");
    assert.equal(
      contexts[1][0].english,
      "The natural numbers are contained in the integers.",
    );
  } finally {
    f.translator.dispose();
  }
});
test("Post-editing may merge and later split whole previous groups without losing English or timestamps", () => {
  const rows = ["a", "b", "c"].map((id, i) => ({
    id,
    english: "Raw " + id,
    chinese: "初译" + id,
    offset_ms: i * 1000,
    translation_group: [],
  }));
  const first = refinementWindow(rows, new Set(["a", "b"]));
  const merged = applyRefinement(rows, first.expected, [
    { ids: ["a", "b", "c"], translation: "合并句" },
  ]);
  assert.equal(displaySegments(merged).length, 1);
  const second = refinementWindow(merged, new Set(["c"]));
  assert.deepEqual(second.drafts[0].ids, ["a", "b", "c"]);
  const split = applyRefinement(merged, second.expected, [
    { ids: ["a", "b"], translation: "第一句" },
    { ids: ["c"], translation: "第二句" },
  ]);
  assert.equal(displaySegments(split).length, 2);
  assert.deepEqual(
    split.map((r) => [r.id, r.english, r.offset_ms]),
    rows.map((r) => [r.id, r.english, r.offset_ms]),
  );
  const newer = split.map((r) => ({ ...r, chinese: r.chinese + "更新" }));
  assert.equal(
    applyRefinement(newer, second.expected, [
      { ids: ["a", "b", "c"], translation: "旧结果" },
    ]),
    newer,
  );
});
test("Post-edit failure preserves visible draft translations and supports an explicit retry", async () => {
  let fail = true;
  const f = fixture({
    refine: async (window) => {
      if (fail) throw new Error("offline");
      return [
        { ids: window.fragments.map((r) => r.id), translation: "润色成功" },
      ];
    },
  });
  try {
    f.append("a");
    await f.translator.finish();
    assert.equal(f.rows()[0].chinese, "初译a");
    assert.equal(f.errors[0][2], "refine");
    assert.equal(f.counts.at(-1)[1], false);
    fail = false;
    f.translator.retryRefinement("a");
    await f.translator.finish();
    assert.equal(f.rows()[0].chinese, "润色成功");
  } finally {
    f.translator.dispose();
  }
});
test("Failed primary requests remain retryable; stop drains both stages exactly once", async () => {
  let fail = true,
    calls = 0;
  const f = fixture({
    translate: async () => {
      calls++;
      if (fail) throw new Error("offline");
      return "恢复初译";
    },
  });
  try {
    f.append("a");
    await delay();
    assert.ok(f.translator.has("a"));
    assert.equal(f.errors[0][2], "draft");
    fail = false;
    await Promise.all([f.translator.finish(), f.translator.finish()]);
    assert.equal(calls, 2);
    assert.equal(f.refines.length, 1);
    assert.ok(!f.translator.has("a"));
  } finally {
    f.translator.dispose();
  }
});
test("After save recovery, failed post-edits resume together without retranslating initial drafts", async () => {
  let canSave = false, commits = 0;
  const f = fixture({
    onRefined: async (window, groups) => {
      commits++;
      if (!canSave) throw new Error("初译尚未保存");
      f.setRows(applyRefinement(f.rows(), window.expected, groups));
    },
  });
  try {
    f.append("a");
    f.append("b");
    await f.translator.finish();
    assert.equal(f.errors.at(-1)[2], "refine");
    assert.equal(f.drafts.length, 2);
    canSave = true;
    f.translator.retryRefinements(["a", "b"]);
    await f.translator.finish();
    assert.equal(commits, 2);
    assert.equal(f.drafts.length, 2);
    assert.deepEqual(f.rows()[0].translation_group, ["a", "b"]);
    assert.equal(f.counts.at(-1)[1], false);
  } finally {
    f.translator.dispose();
  }
});
test("Disposed classrooms ignore late initial and refinement responses", async () => {
  let release;
  const gate = new Promise((r) => {
    release = r;
  });
  const f = fixture({ translate: () => gate });
  f.append("a");
  f.translator.dispose();
  release("旧课堂初译");
  await delay();
  assert.equal(f.drafts.length, 0);
  let finishRefine;
  const polishGate = new Promise((r) => {
    finishRefine = r;
  });
  const g = fixture({ refine: () => polishGate });
  g.append("b");
  await delay();
  const finishing = g.translator.finish();
  await delay();
  g.translator.dispose();
  finishRefine([{ ids: ["b"], translation: "旧课堂润色" }]);
  await finishing;
  assert.equal(g.rows()[0].chinese, "初译b");
});
test("Context and editing windows are bounded and cannot merge across an untranslated gap", () => {
  const rows = Array.from({ length: 26 }, (_, i) => ({
    id: String(i),
    english: "English " + i,
    chinese: i === 22 ? "" : "译文" + i,
    offset_ms: i * 1000,
    notes: "private",
    apiKey: "secret",
  }));
  const context = completedContext(rows, "25");
  assert.equal(context.length, 8);
  assert.ok(
    context.every((r) => Object.keys(r).join(",") === "english,chinese"),
  );
  const window = refinementWindow(rows, new Set(["23", "24"]));
  assert.deepEqual(
    window.fragments.map((r) => r.id),
    ["23", "24", "25"],
  );
  const bounded = refinementWindow(rows, new Set(["0"]));
  assert.ok(bounded.fragments.length <= 20);
});
test("Automatic post-editing runs after drafts and revisits a previous completed group when speech continues", async () => {
  const f = fixture({}, [], { debounce: 1, maxWait: 10 });
  try {
    f.append("a", "Integers were introduced because");
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(f.refines.length, 1);
    assert.deepEqual(f.rows()[0].translation_group, ["a"]);
    f.append("b", "natural numbers cannot solve x + 1 = 0.");
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(f.refines.length, 2);
    assert.deepEqual(
      f.refines[1].drafts.map((r) => r.translation),
      ["润色后的连贯译文", "初译b"],
    );
    assert.deepEqual(f.rows()[0].translation_group, ["a", "b"]);
    assert.equal(f.rows()[1].chinese, "");
  } finally {
    f.translator.dispose();
  }
});
