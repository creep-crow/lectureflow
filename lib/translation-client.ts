import { ApiError, api } from "./classroom-client";
import {
  readEventStream,
  type TranslationProgress,
} from "./translation-stream";

export async function translationApi<T>(
  path: string,
  options: RequestInit,
  streaming: boolean,
  progress: (event: TranslationProgress) => void,
): Promise<T> {
  if (!streaming) return api<T>(path, options);
  let response: Response;
  try {
    response = await fetch(path, {
      ...options,
      headers: { "Content-Type": "application/json", ...options.headers },
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(180000)])
        : AbortSignal.timeout(180000),
    });
  } catch {
    throw new ApiError(0, "流式连接失败，请检查网络后重试。");
  }
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const message =
      body &&
      typeof body === "object" &&
      "error" in body &&
      typeof body.error === "string"
        ? body.error
        : "流式翻译请求失败。";
    throw new ApiError(response.status, message);
  }
  if (!response.headers.get("content-type")?.includes("text/event-stream"))
    throw new ApiError(502, "接口未返回流式内容，请关闭流式开关后重试。");
  let result: T | undefined;
  try {
    await readEventStream(response, (raw) => {
      const event = JSON.parse(raw);
      if (event.type === "error")
        throw new ApiError(
          event.status || 502,
          event.error || "流式翻译失败。",
        );
      if (event.type === "result") result = event.data;
      if (
        event.type === "progress" &&
        Number.isFinite(event.characters) &&
        event.characters >= 0
      )
        progress(event);
    });
  } catch (error) {
    throw error instanceof ApiError
      ? error
      : new ApiError(502, "流式翻译中断，原文已保留，请重试。");
  }
  if (result === undefined)
    throw new ApiError(502, "流式翻译提前结束，原文已保留，请重试。");
  return result;
}
