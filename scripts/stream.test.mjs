import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const asModule = (code) =>
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
const streamUrl = asModule(await compile("../lib/translation-stream.ts"));
const { readEventStream, readCompletionStream } = await import(streamUrl);
const serverUrl = asModule(
  "export class HttpError extends Error {constructor(status,message){super(message);this.status=status}}",
);
const { HttpError } = await import(serverUrl);
const { translationStreamResponse } = await import(
  asModule(
    (await compile("../lib/translation-stream-response.ts")).replace(
      'from "./server"',
      "from " + JSON.stringify(serverUrl),
    ),
  )
);
function packets(text, size = 1) {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return new Response(
    new ReadableStream({
      pull(controller) {
        if (offset >= bytes.length) {
          controller.close();
          return;
        }
        controller.enqueue(bytes.slice(offset, offset + size));
        offset += size;
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}
const event = (data) => "data: " + JSON.stringify(data) + "\r\n\r\n";
test("SSE parser preserves UTF-8, CRLF and multiline data split across packets", async () => {
  const received = [];
  await readEventStream(
    packets(": keepalive\r\ndata: 中文\r\ndata: 第二行\r\n\r\ndata: last"),
    (data) => received.push(data),
  );
  assert.deepEqual(received, ["中文\n第二行", "last"]);
});
test("Streamed completion separates thinking progress from final text and requires a finish marker", async () => {
  const raw =
    event({
      choices: [
        { index: 0, delta: { reasoning_content: "private reasoning" } },
      ],
    }) +
    event({ choices: [{ index: 0, delta: { content: "译" } }] }) +
    event({
      choices: [{ index: 0, delta: { content: "文" }, finish_reason: "stop" }],
    }) +
    "data: [DONE]\n\n";
  const progress = [];
  const result = await readCompletionStream(packets(raw, 3), (p) =>
    progress.push(p),
  );
  assert.equal(result.choices[0].message.content, "译文");
  assert.ok(progress.some((p) => p.thinking));
  assert.ok(
    progress.every((p) => !JSON.stringify(p).includes("private reasoning")),
  );
  await assert.rejects(
    readCompletionStream(
      packets(event({ choices: [{ delta: { content: "partial" } }] })),
    ),
    /提前结束/,
  );
  await assert.rejects(
    readCompletionStream(packets(event({ error: { message: "failed" } }))),
    /错误/,
  );
});
test("Application stream delivers progress before a validated final result and preserves retry status", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const received = [];
  const response = translationStreamResponse(async (emit) => {
    emit({ type: "progress", characters: 2, thinking: false });
    await gate;
    return { groups: [{ ids: ["a"], translation: "译文" }] };
  });
  const reading = readEventStream(response, (data) => {
    received.push(JSON.parse(data));
    if (received.length === 1) release();
  });
  await reading;
  assert.equal(received[0].type, "progress");
  assert.equal(received[1].type, "result");
  const error = [];
  await readEventStream(
    translationStreamResponse(async () => {
      throw new HttpError(429, "limited");
    }),
    (raw) => error.push(JSON.parse(raw)),
  );
  assert.equal(error[0].status, 429);
  assert.equal(error[0].type, "error");
});
test("Canceling an application stream aborts its upstream operation", async () => {
  let signal;
  const response = translationStreamResponse(async (_, abort) => {
    signal = abort;
    await new Promise((resolve) =>
      abort.addEventListener("abort", resolve, { once: true }),
    );
    return {};
  });
  const reader = response.body.getReader();
  await reader.cancel();
  assert.equal(signal.aborted, true);
});

test("Browser stream client delivers the final result, rejects interrupted streams, and preserves key-failover status", async (t) => {
  const clientUrl = asModule(
    "export class ApiError extends Error {constructor(status,message){super(message);this.status=status}};export async function api(){return {normal:true}}",
  );
  const { translationApi } = await import(
    asModule(
      (await compile("../lib/translation-client.ts"))
        .replace(
          'from "./classroom-client"',
          "from " + JSON.stringify(clientUrl),
        )
        .replace(
          'from "./translation-stream"',
          "from " + JSON.stringify(streamUrl),
        ),
    )
  );
  const savedFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = savedFetch;
  });
  const progress = [];
  const final = { groups: [{ ids: ["a"], translation: "译文" }] };
  globalThis.fetch = async () =>
    packets(
      event({ type: "progress", characters: 2, thinking: false }) +
        event({ type: "result", data: final }),
    );
  assert.deepEqual(
    await translationApi("/translate", {}, true, (p) => progress.push(p)),
    final,
  );
  assert.equal(progress.length, 1);
  assert.deepEqual(await translationApi("/translate", {}, false, () => {}), {
    normal: true,
  });
  globalThis.fetch = async () =>
    packets(event({ type: "progress", characters: 2, thinking: false }));
  await assert.rejects(
    translationApi("/translate", {}, true, () => {}),
    (e) => e.status === 502,
  );
  globalThis.fetch = async () =>
    packets(event({ type: "error", status: 429, error: "limited" }));
  await assert.rejects(
    translationApi("/translate", {}, true, () => {}),
    (e) => e.status === 429,
  );
  globalThis.fetch = async () =>
    Response.json({ error: "sign in" }, { status: 401 });
  await assert.rejects(
    translationApi("/translate", {}, true, () => {}),
    (e) => e.status === 401,
  );
});
