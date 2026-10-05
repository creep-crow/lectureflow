import { z } from "zod";

export const DEEPSEEK_URL = "https://api.deepseek.com";
export const OPENAI_URL = "https://api.openai.com/v1";
export type TranslationProtocol = "deepseek" | "openai";
export const translationFields = {
  protocol: z.enum(["deepseek", "openai"]).default("deepseek"),
  baseUrl: z.string().trim().max(500).default(DEEPSEEK_URL),
  stream: z.boolean().default(false),
  thinking: z.boolean().default(false),
  thinkingControl: z.boolean().default(false),
};
export const modelId = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9_.:/@+-]+$/);

/** Only OpenAI-compatible mode preserves explicit endpoint paths. */
export function normalizeTranslationUrl(
  value: string,
  protocol: TranslationProtocol = "deepseek",
) {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.port && url.port !== "443") ||
    !host.includes(".") ||
    host.endsWith(".") ||
    /^[\d.]+$/.test(host) ||
    host.includes(":") ||
    /(^|\.)(localhost|local|internal|lan|home|test|invalid)$/.test(host) ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  )
    throw new Error("请填写公开的 HTTPS 接口网址，不含查询参数或账号密码。");
  if (
    protocol === "openai" &&
    /\/(chat\/completions|models)\/?$/.test(url.pathname)
  )
    return url.toString();
  if (protocol === "deepseek")
    url.pathname = url.pathname.replace(/\/(chat\/completions|models)\/?$/, "");
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}
export type TranslationEndpoint = "/chat/completions" | "/models";
/** An explicit chat URL is used directly; model discovery uses its sibling route. */
export function translationEndpoint(
  value: string,
  endpoint: TranslationEndpoint,
  protocol: TranslationProtocol,
) {
  const normalized = normalizeTranslationUrl(value, protocol);
  if (protocol === "deepseek") return normalized + endpoint;
  const url = new URL(normalized);
  const match = url.pathname.match(/\/(chat\/completions|models)\/?$/);
  if (match) {
    if (match[1] === endpoint.slice(1)) return normalized;
    url.pathname = url.pathname.slice(0, match.index) + endpoint;
    return url.toString();
  }
  return normalized + endpoint;
}
export function usesDefaultTranslationKey(
  protocol: TranslationProtocol,
  baseUrl: string,
) {
  return (
    protocol === "deepseek" &&
    [DEEPSEEK_URL, DEEPSEEK_URL + "/v1"].includes(
      normalizeTranslationUrl(baseUrl, protocol),
    )
  );
}
export function completionOptions(
  protocol: TranslationProtocol,
  baseUrl: string,
  json = false,
  stream = false,
  thinking = false,
  thinkingControl = false,
) {
  return {
    stream,
    ...(json ? { response_format: { type: "json_object" } } : {}),
    ...(protocol === "deepseek"
      ? {
          thinking: { type: thinking ? "enabled" : "disabled" },
          ...(thinking ? {} : { temperature: 0.1 }),
          max_tokens: 8192,
        }
      : new URL(baseUrl).hostname === "api.openai.com"
        ? { max_completion_tokens: 8192 }
        : { max_tokens: 8192 }),
    ...(protocol === "openai" && (thinking || thinkingControl)
      ? { reasoning_effort: thinking ? "medium" : "none" }
      : {}),
  };
}
