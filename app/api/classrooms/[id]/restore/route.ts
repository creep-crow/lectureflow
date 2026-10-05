import { handle, identifier, json, sameOrigin, user } from "@/lib/server";
import { restoreClassroom } from "@/lib/classroom-store";
export const POST = (req: Request, ctx: { params: Promise<{ id: string }> }) =>
  handle(async () => {
    sameOrigin(req);
    const owner = user(req),
      id = identifier.parse((await ctx.params).id);
    return json(await restoreClassroom(owner, id));
  });
