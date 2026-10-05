export type TranslationProgress = {
  type: "progress";
  characters: number;
  thinking: boolean;
};

/** Parse SSE incrementally, including UTF-8 and CRLF split across network packets. */
export async function readEventStream(
  response: Response,
  receive: (data: string) => void,
) {
  if (!response.body) throw new Error("流式接口未返回内容。");
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = "",
    lines: string[] = [];
  const dispatch = () => {
    if (lines.length) receive(lines.join("\n"));
    lines = [];
  };
  const consume = (line: string) => {
    line = line.replace(/\r$/, "");
    if (!line) dispatch();
    else if (line.startsWith("data:"))
      lines.push(line.slice(5).replace(/^ /, ""));
    if (lines.reduce((n, line) => n + line.length, 0) > 1000000)
      throw new Error("流式事件过大。");
  };
  try {
    while (true) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        consume(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
      }
      if (buffer.length > 1000000) throw new Error("流式事件过大。");
      if (chunk.done) {
        if (buffer) consume(buffer);
        dispatch();
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export async function readCompletionStream(
  response: Response,
  progress?: (event: TranslationProgress) => void,
) {
  let content = "",
    finish: string | null = null,
    done = false;
  await readEventStream(response, (raw) => {
    if (raw === "[DONE]") {
      done = true;
      return;
    }
    if (done) return;
    const event = JSON.parse(raw);
    if (event.error) throw new Error("翻译接口返回了流式错误。");
    const choice =
      event.choices?.find((item: { index?: number }) => item.index === 0) ||
      event.choices?.[0];
    if (!choice) return;
    if (
      typeof choice.delta?.reasoning_content === "string" &&
      choice.delta.reasoning_content
    )
      progress?.({ type: "progress", characters: 0, thinking: true });
    if (typeof choice.delta?.content === "string") {
      content += choice.delta.content;
      if (content.length > 256000) throw new Error("流式翻译内容过大。");
      progress?.({
        type: "progress",
        characters: choice.delta.content.length,
        thinking: false,
      });
    }
    if (typeof choice.finish_reason === "string") finish = choice.finish_reason;
  });
  if (!finish || !content.trim())
    throw new Error("流式翻译提前结束或没有完整内容。");
  return { choices: [{ message: { content }, finish_reason: finish }] };
}
