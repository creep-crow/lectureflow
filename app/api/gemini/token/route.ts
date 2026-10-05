import { z } from "zod";
import {
  body,
  handle,
  json,
  sameOrigin,
  user,
  secret,
  upstream,
  HttpError,
} from "@/lib/server";
import { LIVE_MODEL } from "@/lib/classroom-types";
export const POST = (req: Request) =>
  handle(async () => {
    sameOrigin(req);
    user(req);
    const key = secret(req, "GEMINI_API_KEY");
    const { model } = z
      .object({
        model: z
          .string()
          .regex(/^gemini-[a-zA-Z0-9.-]+$/)
          .max(100)
          .default(LIVE_MODEL),
      })
      .strict()
      .parse(await body(req));
    const config = {
      responseModalities: ["TEXT"],
      inputAudioTranscription: { languageCodes: ["en-US"] },
    };
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/auth_tokens",
      {
        method: "POST",
        headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify({
          uses: 1,
          expireTime: new Date(Date.now() + 5 * 60000).toISOString(),
          newSessionExpireTime: new Date(Date.now() + 60000).toISOString(),
          // Lock the model; let the Live connection supply transcription settings.
          // Locking inputAudioTranscription in the token currently drops audio sessions.
          fieldMask: "model",
          bidiGenerateContentSetup: {
            model: "models/" + model,
          },
        }),
        signal: AbortSignal.timeout(20000),
      },
    );
    await upstream(response, "Gemini");
    const token = (await response.json()) as { name?: string };
    if (!token.name) throw new HttpError(502, "Gemini 未返回连接令牌。");
    return json({ token: token.name, model, config, apiVersion: "v1alpha" });
  });
