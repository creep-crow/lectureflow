import { HttpError } from "./server";
import type { TranslationProgress } from "./translation-stream";

export function translationStreamResponse<T>(
  action: (
    emit: (event: TranslationProgress) => void,
    signal: AbortSignal,
  ) => Promise<T>,
) {
  const abort = new AbortController();
  let canceled = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) => {
        if (!canceled)
          controller.enqueue(
            new TextEncoder().encode("data: " + JSON.stringify(event) + "\n\n"),
          );
      };
      try {
        const result = await action(send, abort.signal);
        send({ type: "result", data: result });
      } catch (error) {
        send({
          type: "error",
          status: error instanceof HttpError ? error.status : 502,
          error:
            error instanceof HttpError
              ? error.message
              : "流式翻译未完成，原文已保留，请重试。",
        });
      } finally {
        if (!canceled) controller.close();
      }
    },
    cancel() {
      canceled = true;
      abort.abort();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
