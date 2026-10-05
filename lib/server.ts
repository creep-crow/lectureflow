import { env } from "cloudflare:workers";
import { z } from "zod";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function user(request: Request) {
  const id = request.headers.get("oai-authenticated-user-id");
  if (!id) throw new HttpError(401, "请先登录课堂空间。");
  return id;
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    throw new HttpError(403, "不允许跨站请求。");
}
export async function body(request: Request, limit = 200000) {
  if (Number(request.headers.get("content-length") || 0) > limit)
    throw new HttpError(413, "请求内容过大。");
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > limit)
    throw new HttpError(413, "请求内容过大。");
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, "请求必须是 JSON。");
  }
}
export function db() {
  const binding = (env as { DB?: D1Database }).DB;
  if (!binding) throw new HttpError(503, "课堂存储尚未配置。");
  return binding;
}
export function secret(
  request: Request,
  name: "GEMINI_API_KEY" | "DEEPSEEK_API_KEY",
) {
  const header = name === "GEMINI_API_KEY" ? "x-gemini-key" : "x-deepseek-key";
  const value =
    request.headers.get(header) || (env as Record<string, unknown>)[name];
  if (typeof value !== "string" || !value.trim())
    throw new HttpError(
      400,
      name === "GEMINI_API_KEY"
        ? "请在连接设置中填写 Google AI Studio API Key。"
        : "请在连接设置中填写 DeepSeek API Key。",
    );
  if (value.length > 512) throw new HttpError(400, "密钥格式不正确。");
  return value.trim();
}
export function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
export async function handle(action: () => Promise<Response>) {
  try {
    return await action();
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    if (e instanceof z.ZodError)
      return json(
        {
          error: "输入参数无效。",
          details: e.issues.map((i) => ({ path: i.path, message: i.message })),
        },
        400,
      );
    return json(
      { error: "操作未完成，请重试。课堂内容仍保留在当前页面。" },
      500,
    );
  }
}
export async function upstream(response: Response, provider: string) {
  if (response.ok) return;
  const message =
    response.status === 401 || response.status === 403
      ? "密钥无效或没有模型访问权限"
      : response.status === 429
        ? "请求过于频繁或额度不足"
        : response.status === 404
          ? "模型不可用，请检查模型名称"
          : "服务暂时不可用";
  throw new HttpError(
    response.status === 429 ? 429 : 502,
    provider + "：" + message + "（" + response.status + "）。",
  );
}
export const identifier = z.string().uuid();
