import { z } from "zod";
import { body, handle, identifier, json, sameOrigin, user } from "@/lib/server";
import {
  readClassroom,
  saveNotes,
  renameClassroom,
  deleteClassroom,
} from "@/lib/classroom-store";
type Context = { params: Promise<{ id: string }> };
export const PUT = (req: Request, ctx: Context) =>
  handle(async () => {
    sameOrigin(req);
    const owner = user(req),
      id = identifier.parse((await ctx.params).id);
    const data = z
      .object({
        title: z.string().trim().min(1).max(160),
        revision: z.number().int().nonnegative(),
      })
      .strict()
      .parse(await body(req));
    return json(await renameClassroom(owner, id, data.title, data.revision));
  });
export const DELETE = (req: Request, ctx: Context) =>
  handle(async () => {
    sameOrigin(req);
    const owner = user(req),
      id = identifier.parse((await ctx.params).id);
    const data = z
      .object({ revision: z.number().int().nonnegative() })
      .strict()
      .parse(await body(req));
    return json(await deleteClassroom(owner, id, data.revision));
  });
export const GET = (req: Request, ctx: Context) =>
  handle(async () => {
    const owner = user(req);
    const id = identifier.parse((await ctx.params).id);
    const url = new URL(req.url);
    const cursor = z.coerce
      .number()
      .int()
      .nonnegative()
      .parse(url.searchParams.get("cursor") || 0);
    return json(
      await readClassroom(
        owner,
        id,
        cursor,
        url.searchParams.get("segments") === "0" ? 0 : 100,
      ),
    );
  });
export const PATCH = (req: Request, ctx: Context) =>
  handle(async () => {
    sameOrigin(req);
    const owner = user(req);
    const id = identifier.parse((await ctx.params).id);
    const data = z
      .object({
        notes: z.string().max(100000),
        revision: z.number().int().nonnegative(),
      })
      .strict()
      .parse(await body(req));
    return json(await saveNotes(owner, id, data.notes, data.revision));
  });
