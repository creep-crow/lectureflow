import { z } from "zod";
import { body, handle, identifier, json, sameOrigin, user } from "@/lib/server";
import { saveSegments } from "@/lib/classroom-store";
const schema = z
  .object({
    segments: z
      .array(
        z
          .object({
            id: identifier,
            offset_ms: z.number().int().min(0).max(86400000),
            english: z.string().trim().min(1).max(12000),
            chinese: z.string().max(16000),
            // Empty means an initial translation has not been grouped yet.
            translation_group: z.array(identifier).max(20).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();
export const POST = (req: Request, ctx: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    sameOrigin(req);
    const owner = user(req);
    const id = identifier.parse((await ctx.params).id);
    const { segments } = schema.parse(await body(req, 1000000));
    return json(await saveSegments(owner, id, segments));
  });
