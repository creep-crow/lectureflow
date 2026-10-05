import { z } from "zod";
import { body, handle, json, sameOrigin, user } from "@/lib/server";
import {
  listClassrooms,
  createClassroom,
  managedClassrooms,
} from "@/lib/classroom-store";
export const GET = (req: Request) =>
  handle(async () => {
    const owner = user(req);
    const url = new URL(req.url);
    if (url.searchParams.get("manage") === "1") {
      const offset = z.coerce
        .number()
        .int()
        .min(0)
        .max(1000000)
        .parse(url.searchParams.get("offset") || 0);
      const query = z
        .string()
        .max(160)
        .parse(url.searchParams.get("q") || "");
      const view = z
        .enum(["active", "trash"])
        .parse(url.searchParams.get("view") || "active");
      return json(
        await managedClassrooms(owner, view === "trash", query, offset),
      );
    }
    return json({ classrooms: await listClassrooms(owner) });
  });
export const POST = (req: Request) =>
  handle(async () => {
    sameOrigin(req);
    const owner = user(req);
    const { title } = z
      .object({ title: z.string().trim().min(1).max(160) })
      .strict()
      .parse(await body(req));
    return json(await createClassroom(owner, title), 201);
  });
