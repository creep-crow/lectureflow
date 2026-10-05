import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const asModule = (source) =>
  "data:text/javascript;base64," + Buffer.from(source).toString("base64");
function compile(source) {
  return ts
    .transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
      },
    })
    .outputText.replace(
      'from "zod"',
      "from " + JSON.stringify(import.meta.resolve("zod")),
    );
}
const configUrl = asModule(
  compile(
    await readFile(
      new URL("../lib/translation-config.ts", import.meta.url),
      "utf8",
    ),
  ),
);
const config = await import(configUrl);
test("Provider URL validation preserves complete endpoints and accepts base URLs", () => {
  assert.equal(
    config.normalizeTranslationUrl(
      "https://api.deepseek.com/v1/chat/completions/",
      "openai",
    ),
    "https://api.deepseek.com/v1/chat/completions/",
  );
  assert.equal(
    config.normalizeTranslationUrl(
      "https://api.openai.com/v1/models",
      "openai",
    ),
    "https://api.openai.com/v1/models",
  );
  assert.equal(
    config.normalizeTranslationUrl("https://gateway.example.com/custom/v1/"),
    "https://gateway.example.com/custom/v1",
  );
  for (const url of [
    "http://api.example.com",
    "https://127.0.0.1",
    "https://[::1]",
    "https://localhost",
    "https://metadata.google.internal",
    "https://api.example.com/?api_key=x",
    "https://user:pass@api.example.com",
    "https://api.example.com:8443",
    "https://0x7f000001",
  ])
    assert.throws(() => config.normalizeTranslationUrl(url));
});
test("Complete chat endpoints are used exactly once and model discovery uses their sibling route", () => {
  for (const base of [
    "https://gateway.example.com/v1",
    "https://gateway.example.com/prefix/v1",
  ]) {
    const chat = base + "/chat/completions";
    assert.equal(
      config.translationEndpoint(base, "/chat/completions", "openai"),
      chat,
    );
    assert.equal(
      config.translationEndpoint(chat, "/chat/completions", "openai"),
      chat,
    );
    assert.equal(
      config.translationEndpoint(chat + "/", "/chat/completions", "openai"),
      chat + "/",
    );
    assert.equal(
      config.translationEndpoint(chat, "/models", "openai"),
      base + "/models",
    );
    assert.equal(
      config.translationEndpoint(chat + "/", "/models", "openai"),
      base + "/models",
    );
    assert.equal(
      config.translationEndpoint(
        base + "/models",
        "/chat/completions",
        "openai",
      ),
      chat,
    );
  }
});
test("DeepSeek retains its original base URL normalization and endpoint appending", () => {
  for (const value of [
    "https://api.deepseek.com/v1/",
    "https://api.deepseek.com/v1/chat/completions/",
    "https://api.deepseek.com/v1/models",
  ]) {
    assert.equal(
      config.normalizeTranslationUrl(value, "deepseek"),
      "https://api.deepseek.com/v1",
    );
    assert.equal(
      config.translationEndpoint(value, "/chat/completions", "deepseek"),
      "https://api.deepseek.com/v1/chat/completions",
    );
    assert.equal(
      config.translationEndpoint(value, "/models", "deepseek"),
      "https://api.deepseek.com/v1/models",
    );
  }
});
test("Stored credential is limited to exact official DeepSeek destinations", () => {
  assert.equal(
    config.usesDefaultTranslationKey("deepseek", "https://api.deepseek.com/v1"),
    true,
  );
  assert.equal(
    config.usesDefaultTranslationKey(
      "deepseek",
      "https://api.deepseek.com/v1/chat/completions",
    ),
    true,
  );
  for (const [protocol, url] of [
    ["openai", "https://api.deepseek.com"],
    ["deepseek", "https://api.deepseek.com.evil.example"],
    ["deepseek", "https://api.deepseek.com/other"],
    ["openai", "https://api.openai.com/v1"],
  ])
    assert.equal(config.usesDefaultTranslationKey(protocol, url), false);
});
test("Adapter payloads isolate DeepSeek fields and support namespaced model IDs", () => {
  const ds = config.completionOptions(
    "deepseek",
    "https://api.deepseek.com",
    true,
  );
  assert.deepEqual(ds.thinking, { type: "disabled" });
  assert.equal(ds.max_tokens, 8192);
  const oai = config.completionOptions(
    "openai",
    "https://api.openai.com/v1",
    true,
  );
  assert.equal(oai.thinking, undefined);
  assert.equal(oai.temperature, undefined);
  assert.equal(oai.max_completion_tokens, 8192);
  assert.equal(oai.max_tokens, undefined);
  assert.equal(
    config.completionOptions("openai", "https://gateway.example.com/v1")
      .max_tokens,
    8192,
  );
  assert.equal(
    config.modelId.safeParse("vendor/text-model:free").success,
    true,
  );
});
const serverUrl = asModule(
  `export class HttpError extends Error {constructor(status,message){super(message);this.status=status}};export function secret(){return 'server-credential'};export async function upstream(r){if(!r.ok)throw new HttpError(502,'upstream');}`,
);
test("Stream and thinking switches use provider-specific parameters with a compatible default", () => {
  const ds = config.completionOptions(
    "deepseek",
    "https://api.deepseek.com",
    true,
    true,
    true,
    true,
  );
  assert.equal(ds.stream, true);
  assert.deepEqual(ds.thinking, { type: "enabled" });
  assert.equal(ds.temperature, undefined);
  assert.equal(ds.reasoning_effort, undefined);
  const url = "https://gateway.example.com/v1/chat/completions";
  assert.equal(
    config.completionOptions("openai", url).reasoning_effort,
    undefined,
  );
  assert.equal(
    config.completionOptions("openai", url, true, false, false, true)
      .reasoning_effort,
    "none",
  );
  const enabled = config.completionOptions(
    "openai",
    url,
    true,
    true,
    true,
    true,
  );
  assert.equal(enabled.reasoning_effort, "medium");
  assert.equal(enabled.stream, true);
  assert.equal(enabled.thinking, undefined);
});
const providerUrl = asModule(
  compile(
    await readFile(
      new URL("../lib/translation-provider.ts", import.meta.url),
      "utf8",
    ),
  )
    .replace('from "./server"', "from " + JSON.stringify(serverUrl))
    .replace(
      'from "./translation-stream"',
      "from " +
        JSON.stringify(
          asModule(
            compile(
              await readFile(
                new URL("../lib/translation-stream.ts", import.meta.url),
                "utf8",
              ),
            ),
          ),
        ),
    )
    .replace(
      'from "./translation-config"',
      "from " + JSON.stringify(configUrl),
    ),
);
const provider = await import(providerUrl);
test("Transport authenticates models and completions, blocks redirects and malformed content", async (t) => {
  const savedFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = savedFetch;
  });
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return Response.json({ data: [{ id: "vendor/text" }] });
  };
  const req = new Request("https://lecture.example.com", {
    headers: { "x-translation-key": "custom-key" },
  });
  const connection = provider.translationConnection(req, {
    protocol: "openai",
    baseUrl: "https://gateway.example.com/v1",
  });
  await provider.translationFetch(connection, "/models");
  await provider.translationFetch(connection, "/chat/completions", {
    model: "vendor/text",
    messages: [],
  });
  assert.equal(calls[0].url, "https://gateway.example.com/v1/models");
  assert.equal(calls[0].init.headers.Authorization, "Bearer custom-key");
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[1].init.method, "POST");
  assert.equal(calls[1].url, "https://gateway.example.com/v1/chat/completions");
  assert.equal(calls[1].init.redirect, "manual");
  for (const protocol of ["openai", "deepseek"]) {
    const explicit = provider.translationConnection(req, {
      protocol,
      baseUrl: "https://gateway.example.com/prefix/v1/chat/completions",
    });
    await provider.translationFetch(explicit, "/models");
    await provider.translationFetch(explicit, "/chat/completions", {
      model: "vendor/text",
      messages: [],
    });
    assert.equal(
      calls.at(-2).url,
      "https://gateway.example.com/prefix/v1/models",
    );
    assert.equal(
      calls.at(-1).url,
      "https://gateway.example.com/prefix/v1/chat/completions",
    );
    assert.equal(
      explicit.baseUrl,
      protocol === "openai"
        ? "https://gateway.example.com/prefix/v1/chat/completions"
        : "https://gateway.example.com/prefix/v1",
    );
    assert.equal(calls.at(-1).init.headers.Authorization, "Bearer custom-key");
  }
  assert.throws(
    () =>
      provider.translationConnection(new Request(req.url), {
        protocol: "openai",
        baseUrl: "https://gateway.example.com/v1",
      }),
    /API Key/,
  );
  globalThis.fetch = async () =>
    new Response(null, {
      status: 302,
      headers: { Location: "https://other.example.com" },
    });
  await assert.rejects(
    () => provider.translationFetch(connection, "/models"),
    /重定向/,
  );
  assert.equal(
    provider.completionText({
      choices: [{ message: { content: "译文" }, finish_reason: "stop" }],
    }),
    "译文",
  );
  for (const data of [
    {},
    { choices: [{ message: { content: "" } }] },
    { choices: [{ message: { content: "截断" }, finish_reason: "length" }] },
    { choices: [{ message: { content: 17 } }] },
  ])
    assert.throws(() => provider.completionText(data));
});
