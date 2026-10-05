import { HttpError, secret, upstream } from "./server";
import { z } from "zod";
import {
  readCompletionStream,
  type TranslationProgress,
} from "./translation-stream";
import {
  normalizeTranslationUrl,
  translationEndpoint,
  type TranslationEndpoint,
  usesDefaultTranslationKey,
  type TranslationProtocol,
} from "./translation-config";

export function translationConnection(
  req: Request,
  input: { protocol: TranslationProtocol; baseUrl: string },
) {
  let baseUrl: string;
  try {
    baseUrl = normalizeTranslationUrl(input.baseUrl, input.protocol);
  } catch {
    throw new HttpError(
      400,
      "请填写公开的 HTTPS 接口网址，不含查询参数或账号密码。",
    );
  }
  const supplied = req.headers.get("x-translation-key")?.trim();
  // A custom destination must never receive the server's stored DeepSeek credential.
  const key =
    supplied ||
    (usesDefaultTranslationKey(input.protocol, baseUrl)
      ? secret(req, "DEEPSEEK_API_KEY")
      : "");
  if (!key || key.length > 512 || /[\r\n]/.test(key))
    throw new HttpError(400, "请为所选翻译接口填写有效 API Key。");
  return {
    protocol: input.protocol,
    baseUrl,
    key,
    label: input.protocol === "deepseek" ? "DeepSeek" : "翻译接口",
  };
}
export async function translationFetch(
  connection: ReturnType<typeof translationConnection>,
  path: TranslationEndpoint,
  payload?: unknown,
  progress?: (event: TranslationProgress) => void,
  signal?: AbortSignal,
) {
  const options = payload as
    | {
        stream?: boolean;
        thinking?: { type?: string };
        reasoning_effort?: string;
      }
    | undefined;
  const timeout = !payload
    ? 20000
    : options?.stream ||
        options?.thinking?.type === "enabled" ||
        (options?.reasoning_effort && options.reasoning_effort !== "none")
      ? 180000
      : 45000;
  let response: Response;
  try {
    response = await fetch(
      translationEndpoint(connection.baseUrl, path, connection.protocol),
      {
        method: payload ? "POST" : "GET",
        headers: {
          Authorization: "Bearer " + connection.key,
          "Content-Type": "application/json",
        },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
        redirect: "manual",
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(timeout)])
          : AbortSignal.timeout(timeout),
      },
    );
  } catch {
    throw new HttpError(502, "无法连接翻译接口，请检查网址和网络后重试。");
  }
  if (response.status >= 300 && response.status < 400)
    throw new HttpError(502, "接口返回了重定向，请填写最终接口网址后重试。");
  await upstream(response, connection.label);
  try {
    if ((payload as { stream?: boolean })?.stream) {
      if (!response.headers.get("content-type")?.includes("text/event-stream"))
        throw new Error("Expected SSE");
      return await readCompletionStream(response, progress);
    }
    return await response.json();
  } catch {
    throw new HttpError(
      502,
      "翻译接口未返回完整有效内容，请检查流式开关、模型和网址。",
    );
  }
}
export function completionText(data: unknown) {
  const result = z
    .object({
      choices: z
        .array(
          z.object({
            message: z.object({ content: z.string().nullable() }),
            finish_reason: z.string().nullish(),
          }),
        )
        .min(1),
    })
    .safeParse(data);
  if (
    !result.success ||
    !result.data.choices[0].message.content?.trim() ||
    result.data.choices[0].finish_reason === "length"
  )
    throw new HttpError(
      502,
      "翻译接口返回的内容为空或不完整，请检查模型后重试。",
    );
  return result.data.choices[0].message.content!;
}
