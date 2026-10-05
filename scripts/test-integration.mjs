import assert from "node:assert/strict";
const base = process.env.TEST_URL || "http://127.0.0.1:5173";
const sign = await fetch(base + "/signin-with-chatgpt?return_to=/", {
  redirect: "manual",
});
const cookie = sign.headers.get("set-cookie")?.split(";")[0];
assert.ok(cookie, "Local preview sign-in cookie");
let checks = 0;
async function request(
  path,
  body,
  auth = true,
  method = body ? "POST" : "GET",
  extra = {},
) {
  const r = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { Cookie: cookie } : {}),
      ...extra,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data;
  try {
    data = await r.json();
  } catch {}
  return { status: r.status, data };
}
function check(v, message) {
  assert.ok(v, message);
  checks++;
  console.log("PASS " + message);
}
check(
  (await request("/api/classrooms", null, false)).status === 401,
  "anonymous classroom access denied",
);
check(
  (
    await request("/api/classrooms", null, false, "GET", {
      "oai-authenticated-user-id": "local_seedy",
    })
  ).status === 401,
  "spoofed identity headers rejected by preview boundary",
);
check(
  (
    await request("/api/classrooms", { title: "x" }, true, "POST", {
      Origin: "https://evil.example",
    })
  ).status === 403,
  "cross-origin writes denied",
);
check(
  (await request("/api/classrooms", { title: "" })).status === 400,
  "empty classroom rejected",
);
const created = await request("/api/classrooms", {
  title: "Integration test · disposable local fixture",
});
check(created.status === 201, "classroom creation");
const id = created.data.id;
const rows = Array.from({ length: 103 }, (_, i) => ({
  id: crypto.randomUUID(),
  offset_ms: i * 1000,
  english: "Test sentence " + i,
  chinese: "测试句 " + i,
  translation_group: [],
}));
check(
  (
    await request("/api/classrooms/" + id + "/segments", {
      segments: [{ ...rows[0], chinese: "" }],
    })
  ).status === 200,
  "browser ungrouped raw fragment can be saved with an explicit empty group",
);
for (let i = 0; i < rows.length; i += 40)
  assert.equal(
    (
      await request("/api/classrooms/" + id + "/segments", {
        segments: rows.slice(i, i + 40),
      })
    ).status,
    200,
  );
const page = await request("/api/classrooms/" + id);
check(
  page.data.segments.length === 100 && page.data.nextCursor,
  "transcript pagination first page",
);
const tail = await request(
  "/api/classrooms/" + id + "?cursor=" + page.data.nextCursor,
);
check(
  tail.data.segments.length === 3 && tail.data.nextCursor === null,
  "transcript pagination tail",
);
await request("/api/classrooms/" + id + "/segments", {
  segments: [{ ...rows[0], chinese: "修订翻译" }],
});
const again = await request("/api/classrooms/" + id);
check(
  again.data.segments.length === 100 &&
    again.data.segments[0].chinese === "修订翻译",
  "segment retry is idempotent and translation updates",
);
const note = await request(
  "/api/classrooms/" + id,
  { notes: "My own notes", revision: 0 },
  true,
  "PATCH",
);
check(
  note.status === 200 && note.data.revision === 1,
  "notes saved with revision",
);
check(
  (
    await request(
      "/api/classrooms/" + id,
      { notes: "Stale content", revision: 0 },
      true,
      "PATCH",
    )
  ).status === 409,
  "stale notes cannot overwrite newer content",
);
let rpcId = 0;
const rpc = (method, params = {}, auth = true) =>
  request("/mcp", { jsonrpc: "2.0", id: ++rpcId, method, params }, auth);
check(
  (await rpc("initialize", { protocolVersion: "2025-06-18" })).data.result
    .serverInfo.name === "lectureflow",
  "MCP initialize",
);
const discovery = await rpc("tools/list");
check(
  discovery.data.result.tools.length === 4 &&
    !JSON.stringify(discovery).includes("My own notes"),
  "MCP discovery exposes tools without private notes",
);
check(
  (await rpc("tools/call", { name: "list_classrooms", arguments: {} }, false))
    .status === 401,
  "MCP data requires authentication",
);
const called = await rpc("tools/call", {
  name: "read_classroom",
  arguments: { classroom_id: id, limit: 2 },
});
check(
  JSON.parse(called.data.result.content[0].text).segments.length === 2,
  "MCP reads paginated classroom content",
);
const args = {
  classroom_id: id,
  request_id: crypto.randomUUID(),
  title: "Test analysis",
  content: "Summary grounded in [00:00] test sentence.",
};
const analysis = await rpc("tools/call", {
  name: "save_classroom_analysis",
  arguments: args,
});
check(!analysis.data.result.isError, "MCP saves analysis");
await rpc("tools/call", { name: "save_classroom_analysis", arguments: args });
const after = await request("/api/classrooms/" + id);
check(
  after.data.analyses.length === 1 &&
    after.data.classroom.notes === "My own notes",
  "analysis retry deduplicates and preserves user notes",
);
const lightweight = await request("/api/classrooms/" + id + "?segments=0");
check(
  lightweight.data.segments.length === 0 &&
    lightweight.data.nextCursor === null &&
    lightweight.data.classroom.revision === 1 &&
    lightweight.data.analyses.length === 1,
  "lightweight poll reads notes and analyses without downloading transcripts",
);
const grouped = await request("/api/classrooms/" + id + "/segments", {
  segments: [
    {
      ...rows[0],
      chinese: "语义完整的合并译文",
      translation_group: [rows[0].id, rows[1].id],
    },
  ],
});
check(grouped.status === 200, "semantic translation group saved");
const groupedRead = await request("/api/classrooms/" + id);
check(
  groupedRead.data.segments[0].english === rows[0].english &&
    groupedRead.data.segments[1].english === rows[1].english &&
    groupedRead.data.segments[0].translation_group.length === 2 &&
    groupedRead.data.segments[0].chinese === "语义完整的合并译文",
  "grouping survives reload without altering original English fragments",
);
check(
  (
    await request("/api/classrooms/" + id + "/segments", {
      segments: [{ ...rows[1], translation_group: [rows[1].id, rows[2].id] }],
    })
  ).status === 409,
  "overlapping semantic groups rejected",
);
check(
  (
    await request("/api/classrooms/" + id + "/segments", {
      segments: [{ ...rows[3], translation_group: [rows[3].id, rows[5].id] }],
    })
  ).status === 400,
  "nonadjacent semantic groups rejected",
);
check(
  (
    await request("/api/classrooms/" + id + "/segments", {
      segments: [
        { ...rows[4], translation_group: [rows[4].id, crypto.randomUUID()] },
      ],
    })
  ).status === 409,
  "unknown group sources reveal no private data",
);
check(
  (
    await request("/api/classrooms/" + id + "/segments", {
      segments: [
        {
          ...rows[99],
          translation_group: rows.slice(99, 102).map((s) => s.id),
        },
      ],
    })
  ).status === 200,
  "translation group can span transcript pages",
);
const pagedGroup = await rpc("tools/call", {
  name: "read_classroom",
  arguments: { classroom_id: id },
});
check(
  JSON.parse(pagedGroup.data.result.content[0].text).segments[99]
    .translation_group.length === 3,
  "MCP retains cross-page source references for full lecture analysis",
);
check(
  (
    await request(
      "/api/translate/segments",
      { fragments: [{ id: rows[0].id, text: "Hello" }] },
      false,
    )
  ).status === 401,
  "semantic translation endpoint requires authentication",
);
check(
  (
    await request("/api/translate/segments", {
      fragments: [
        { id: rows[0].id, text: "x" },
        { id: rows[0].id, text: "y" },
      ],
    })
  ).status === 400,
  "duplicate translation fragments rejected before provider call",
);
const invalid = await rpc("tools/call", {
  name: "save_classroom_analysis",
  arguments: { ...args, classroom_id: "bad" },
});
const refinementIds = rows.slice(40, 43).map((r) => r.id);
const refinementPath = "/api/classrooms/" + id + "/refine";
const refinementSnapshot = async () =>
  (await request("/api/classrooms/" + id)).data.segments
    .filter((r) => refinementIds.includes(r.id))
    .map((r) => ({
      id: r.id,
      chinese: r.chinese,
      translation_group: r.translation_group,
    }));
const initialSnapshot = await refinementSnapshot();
check(
  initialSnapshot.every(
    (r, i) =>
      r.chinese === rows[40 + i].chinese && r.translation_group.length === 0,
  ),
  "browser initial translations replace raw text and reload before post-editing",
);
const joined = {
  expected: initialSnapshot,
  groups: [
    { ids: refinementIds.slice(0, 2), translation: "合并并润色的第一句" },
    { ids: refinementIds.slice(2), translation: "第二句" },
  ],
};
check(
  (await request(refinementPath, joined, false)).status === 401,
  "post-edit saves require authentication",
);
check(
  (
    await request(refinementPath, joined, true, "POST", {
      Origin: "https://evil.example",
    })
  ).status === 403,
  "cross-origin post-edit rejected",
);
check(
  (
    await request(refinementPath, {
      ...joined,
      groups: [{ ids: [refinementIds[0]], translation: "遗漏" }],
    })
  ).status === 400,
  "post-edit must cover all original IDs without omissions",
);
check(
  (await request(refinementPath, joined)).status === 200,
  "completed initial translations may be merged and polished atomically",
);
const mergedSnapshot = await refinementSnapshot();
check(
  mergedSnapshot[0].chinese === "合并并润色的第一句" &&
    mergedSnapshot[0].translation_group.length === 2 &&
    mergedSnapshot[1].chinese === "",
  "post-edit stores text on anchors and clears covered drafts",
);
check(
  (await request(refinementPath, joined)).status === 200,
  "lost post-edit responses can be retried idempotently",
);
check(
  (
    await request(refinementPath, {
      ...joined,
      groups: [{ ids: refinementIds, translation: "过时结果" }],
    })
  ).status === 409,
  "stale post-edit snapshot cannot overwrite newer Chinese",
);
await request("/api/classrooms/" + id + "/segments", {
  segments: rows.slice(40, 42).map((r) => ({ ...r, chinese: "迟到的初译" })),
});
check(
  JSON.stringify(await refinementSnapshot()) === JSON.stringify(mergedSnapshot),
  "late initial saves cannot overwrite polished anchors or their covered sources",
);
const split = {
  expected: mergedSnapshot,
  groups: [
    { ids: [refinementIds[0]], translation: "独立第一句" },
    { ids: refinementIds.slice(1), translation: "重新拼接的第二句" },
  ],
};
check(
  (await request(refinementPath, split)).status === 200,
  "whole previous groups may be split and rejoined",
);
const splitSnapshot = await refinementSnapshot();
check(
  (
    await request(refinementPath, {
      expected: splitSnapshot.slice(0, 2),
      groups: [{ ids: refinementIds.slice(0, 2), translation: "半个已有分组" }],
    })
  ).status === 400,
  "partial existing groups cannot be edited",
);
check(
  (
    await request(refinementPath, {
      expected: [splitSnapshot[0], splitSnapshot[2]],
      groups: [
        { ids: [refinementIds[0], refinementIds[2]], translation: "跳段" },
      ],
    })
  ).status === 400,
  "post-edit cannot cross a gap or omit a group source",
);
const race = await Promise.all(
  ["甲", "乙"].map((translation) =>
    request(refinementPath, {
      expected: splitSnapshot,
      groups: [{ ids: refinementIds, translation }],
    }),
  ),
);
check(
  race
    .map((r) => r.status)
    .sort()
    .join(",") === "200,409",
  "concurrent post-edits apply one complete result and reject stale competition",
);
const raced = await refinementSnapshot();
check(
  ["甲", "乙"].includes(raced[0].chinese) &&
    raced[0].translation_group.length === 3 &&
    !raced[1].chinese &&
    !raced[2].chinese,
  "concurrent refinement never leaves partially replaced groups",
);
const refinedRead = await request("/api/classrooms/" + id);
check(
  refinedRead.data.classroom.revision === 1 &&
    refinedRead.data.classroom.notes === "My own notes" &&
    refinedRead.data.segments
      .slice(40, 43)
      .every(
        (r, i) =>
          r.english === rows[40 + i].english &&
          r.offset_ms === rows[40 + i].offset_ms,
      ),
  "post-edit preserves original English, timestamps, notes and note revision",
);
check(
  (
    await request("/api/translate/segments", {
      fragments: refinementIds.map((id) => ({ id, text: "x" })),
      drafts: [
        {
          id: refinementIds[0],
          ids: [refinementIds[0]],
          translation: "遗漏的已译内容",
        },
      ],
    })
  ).status === 400,
  "post-edit provider input rejects incomplete draft coverage before calling a model",
);
check(
  (
    await request(refinementPath, {
      expected: [
        { id: crypto.randomUUID(), chinese: "", translation_group: [] },
      ],
      groups: [{ ids: [refinementIds[0]], translation: "x" }],
    })
  ).status === 400,
  "post-edit cannot invent unrelated source IDs",
);
check(
  invalid.data.result.isError,
  "invalid MCP tool arguments return tool error",
);
const mismatch = await rpc("tools/call", {
  name: "save_classroom_analysis",
  arguments: { ...args, content: "Different content" },
});
check(
  mismatch.data.result.isError,
  "idempotency key cannot silently accept different content",
);
const missing = await rpc("tools/call", {
  name: "read_classroom",
  arguments: { classroom_id: crypto.randomUUID() },
});
check(missing.data.result.isError, "unknown classroom returns no data");
check(
  (await request("/api/gemini/token", { model: "invalid/model" })).status ===
    400,
  "Gemini invalid input fails before network request",
);
check(
  (await request("/api/translate", { text: "" })).status === 400,
  "DeepSeek invalid input fails before network request",
);
const managed = await request("/api/classrooms?manage=1&q=Integration%20test");
check(
  managed.status === 200 &&
    managed.data.classrooms.some(
      (c) =>
        c.id === id &&
        c.segment_count === 103 &&
        c.analysis_count === 1 &&
        c.has_notes,
    ),
  "management lists owned classroom metadata and counts",
);
const beforeRename = (await request("/api/classrooms/" + id)).data;
check(
  (
    await request(
      "/api/classrooms/" + id,
      {
        title: "Managed record renamed",
        revision: beforeRename.classroom.revision,
      },
      true,
      "PUT",
    )
  ).status === 200,
  "classroom rename",
);
check(
  (
    await request(
      "/api/classrooms/" + id,
      { title: "stale overwrite", revision: beforeRename.classroom.revision },
      true,
      "PUT",
    )
  ).status === 409,
  "stale rename rejected",
);
check(
  (
    await request(
      "/api/classrooms/" + id,
      { revision: beforeRename.classroom.revision },
      true,
      "DELETE",
    )
  ).status === 409,
  "stale deletion rejected",
);
const renamed = (await request("/api/classrooms/" + id)).data;
check(
  (
    await request(
      "/api/classrooms/" + id,
      { revision: renamed.classroom.revision },
      true,
      "DELETE",
      { Origin: "https://evil.example" },
    )
  ).status === 403,
  "cross-origin deletion rejected",
);
check(
  (
    await request(
      "/api/classrooms/" + id,
      { revision: renamed.classroom.revision },
      false,
      "DELETE",
    )
  ).status === 401,
  "anonymous deletion rejected",
);
check(
  (
    await request(
      "/api/classrooms/" + crypto.randomUUID(),
      { revision: 0 },
      true,
      "DELETE",
    )
  ).status === 404,
  "unknown or unowned record deletion reveals no data",
);
check(
  (
    await request(
      "/api/classrooms/" + id,
      { revision: renamed.classroom.revision },
      true,
      "DELETE",
    )
  ).status === 200,
  "classroom moved into recoverable trash",
);
check(
  (await request("/api/classrooms/" + id)).status === 404,
  "trashed content cannot be read",
);
check(
  !(await request("/api/classrooms")).data.classrooms.some((c) => c.id === id),
  "trash hidden from classroom selector",
);
const deletedMcp = await rpc("tools/call", {
  name: "read_classroom",
  arguments: { classroom_id: id },
});
check(deletedMcp.data.result.isError, "MCP cannot read trashed classroom");
check(
  (
    await request("/api/classrooms/" + id + "/segments", {
      segments: [rows[0]],
    })
  ).status === 404,
  "deleted classroom rejects transcript writes",
);
const trash = await request(
  "/api/classrooms?manage=1&view=trash&q=Managed%20record",
);
check(
  trash.data.classrooms.some((c) => c.id === id && c.deleted_at),
  "trash exposes recovery metadata to owner",
);
check(
  (await request("/api/classrooms/" + id + "/restore", {}, false)).status ===
    401,
  "anonymous restore denied",
);
check(
  (
    await request("/api/classrooms/" + id + "/restore", {}, true, "POST", {
      Origin: "https://evil.example",
    })
  ).status === 403,
  "cross-origin restore denied",
);
check(
  (await request("/api/classrooms/" + id + "/restore", {})).status === 200,
  "classroom restored",
);
const restored = (await request("/api/classrooms/" + id)).data;
check(
  restored.classroom.title === "Managed record renamed" &&
    restored.segments.length === 100 &&
    restored.classroom.notes === renamed.classroom.notes &&
    restored.analyses.length === 1,
  "restoring retains original transcript notes analyses and title",
);
check(
  (
    await request(
      "/api/translate/models",
      { protocol: "deepseek", baseUrl: "https://api.deepseek.com" },
      false,
    )
  ).status === 401,
  "model discovery requires sign-in",
);
check(
  (
    await request("/api/translate/models", {
      protocol: "openai",
      baseUrl: "https://api.example.com/v1",
    })
  ).status === 400,
  "custom providers cannot borrow stored server key",
);
check(
  (
    await request("/api/translate/models", {
      protocol: "deepseek",
      baseUrl: "https://api.deepseek.com.evil.example",
    })
  ).status === 400,
  "lookalike provider cannot borrow stored server key",
);
check(
  (
    await request(
      "/api/translate/models",
      { protocol: "openai", baseUrl: "https://127.0.0.1/v1" },
      true,
      "POST",
      { "x-translation-key": "fake-test-key" },
    )
  ).status === 400,
  "private IP provider rejected before key transmission",
);
check(
  (
    await request(
      "/api/translate/models",
      { protocol: "openai", baseUrl: "http://api.example.com/v1" },
      true,
      "POST",
      { "x-translation-key": "fake-test-key" },
    )
  ).status === 400,
  "unencrypted provider rejected",
);
console.log(JSON.stringify({ checks, fixtureClassroom: id }));
