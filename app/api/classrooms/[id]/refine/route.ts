import { z } from "zod";
import { body, handle, identifier, json, sameOrigin, user } from "@/lib/server";
import { refineTranslations } from "@/lib/classroom-store";
const schema = z
  .object({
    expected: z
      .array(
        z
          .object({
            id: identifier,
            chinese: z.string().max(16000),
            translation_group: z.array(identifier).max(20).default([]),
          })
          .strict(),
      )
      .min(1)
      .max(20),
    groups: z
      .array(
        z
          .object({
            ids: z.array(identifier).min(1).max(20),
            translation: z.string().trim().min(1).max(16000),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict();
export const POST = (req: Request, ctx: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    sameOrigin(req);
    const owner = user(req);
    const id = identifier.parse((await ctx.params).id);
    const input = schema.parse(await body(req, 1000000));
    return json(
      await refineTranslations(owner, id, input.expected, input.groups),
    );
  });
