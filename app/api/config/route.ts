import { env } from "cloudflare:workers";
import { handle, json, user } from "@/lib/server";
export const GET = (req: Request) =>
  handle(async () => {
    user(req);
    const config = env as Record<string, unknown>;
    return json({
      gemini: !!config.GEMINI_API_KEY,
      deepseek: !!config.DEEPSEEK_API_KEY,
    });
  });
