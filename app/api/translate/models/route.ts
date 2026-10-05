import { z } from "zod";
import { body, handle, json, sameOrigin, user, HttpError } from "@/lib/server";
import { translationFields, modelId } from "@/lib/translation-config";
import {
  translationConnection,
  translationFetch,
} from "@/lib/translation-provider";

export const POST = (req: Request) =>
  handle(async () => {
    sameOrigin(req);
    user(req);
    const input = z
      .object(translationFields)
      .strict()
      .parse(await body(req));
    const result = await translationFetch(
      translationConnection(req, input),
      "/models",
    );
    const parsed = z
      .object({ data: z.array(z.object({ id: z.string() })).max(10000) })
      .safeParse(result);
    if (!parsed.success)
      throw new HttpError(502, "接口模型列表格式不兼容，请手动填写模型名称。");
    const models = [
      ...new Set(
        parsed.data.data
          .map((m) => m.id)
          .filter((id) => modelId.safeParse(id).success),
      ),
    ].sort();
    if (!models.length)
      throw new HttpError(
        502,
        "接口未返回可用模型，请检查密钥权限或手动填写模型名称。",
      );
    return json({ models });
  });
