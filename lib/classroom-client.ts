import { formatTime, type ClassroomData } from "./classroom-types";
import { displaySegments } from "./semantic-translation";
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...options,
      headers: { "Content-Type": "application/json", ...options.headers },
      signal: options.signal || AbortSignal.timeout(55000),
    });
  } catch (e) {
    throw new ApiError(
      0,
      (e as Error)?.name === "TimeoutError"
        ? "请求超时，请检查网络后重试。"
        : "网络连接失败，请检查网络后重试。",
    );
  }
  let data: (T & { error?: string }) | undefined;
  try {
    data = await response.json();
  } catch {
    /* Gateways may return non-JSON. */
  }
  if (!response.ok)
    throw new ApiError(
      response.status,
      data?.error || `请求失败（${response.status}），请重试。`,
    );
  if (data === undefined)
    throw new ApiError(response.status, "服务返回了无法解析的数据，请重试。");
  return data;
}
export async function readFullClassroom(id: string, signal?: AbortSignal) {
  let first: ClassroomData | undefined,
    cursor: number | null = 0;
  const segments: ClassroomData["segments"] = [];
  do {
    const page: ClassroomData = await api(
      `/api/classrooms/${encodeURIComponent(id)}?cursor=${cursor}`,
      { signal },
    );
    first ??= page;
    segments.push(...page.segments);
    cursor = page.nextCursor;
  } while (cursor !== null);
  return { ...first!, segments, nextCursor: null };
}
export function downloadClassroom(data: ClassroomData) {
  const text =
    `# ${data.classroom.title}\n\n` +
    displaySegments(data.segments)
      .map((s) => `[${formatTime(s.offset_ms)}] ${s.english}\n\n${s.chinese}`)
      .join("\n\n") +
    `\n\n## 我的笔记\n\n${data.classroom.notes}\n\n` +
    data.analyses.map((a) => `## ${a.title}\n\n${a.content}`).join("\n\n");
  const url = URL.createObjectURL(
    new Blob([text], { type: "text/markdown;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = data.classroom.title.replace(/[<>:"/\\|?*]/g, "-") + ".md";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
