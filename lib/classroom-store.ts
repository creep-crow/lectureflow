import { db, HttpError } from "./server";
import type {
  Classroom,
  ClassroomRecord,
  Segment,
  Analysis,
} from "./classroom-types";
import { validateGroups, type TranslationGroup } from "./semantic-translation";
import type { TranslationSnapshot } from "./fast-translation";
export async function managedClassrooms(
  owner: string,
  trash: boolean,
  query: string,
  offset: number,
) {
  const filter = `owner=? AND deleted_at IS ${trash ? "NOT " : ""}NULL AND title LIKE ? ESCAPE '\\'`;
  const search = "%" + query.replace(/[\\%_]/g, "\\$&") + "%";
  const total = await db()
    .prepare(`SELECT COUNT(*) AS n FROM classrooms WHERE ${filter}`)
    .bind(owner, search)
    .first<{ n: number }>();
  const rows = await db()
    .prepare(
      `SELECT id,title,created_at,revision,deleted_at,
    (length(notes)>0) AS has_notes,
    (SELECT COUNT(*) FROM segments WHERE classroom_id=c.id AND owner=c.owner) AS segment_count,
    (SELECT COUNT(*) FROM analyses WHERE classroom_id=c.id AND owner=c.owner) AS analysis_count,
    (SELECT substr(english,1,220) FROM segments WHERE classroom_id=c.id AND owner=c.owner ORDER BY seq LIMIT 1) AS excerpt
    FROM classrooms AS c WHERE ${filter} ORDER BY ${trash ? "deleted_at" : "created_at"} DESC,id DESC LIMIT 30 OFFSET ?`,
    )
    .bind(owner, search, offset)
    .all<ClassroomRecord>();
  return {
    classrooms: rows.results,
    total: total?.n || 0,
    nextOffset:
      offset + rows.results.length < (total?.n || 0)
        ? offset + rows.results.length
        : null,
  };
}
export async function renameClassroom(
  owner: string,
  id: string,
  title: string,
  revision: number,
) {
  await classroom(owner, id);
  const result = await db()
    .prepare(
      "UPDATE classrooms SET title=?,revision=revision+1 WHERE id=? AND owner=? AND deleted_at IS NULL AND revision=?",
    )
    .bind(title, id, owner, revision)
    .run();
  if (!result.meta.changes)
    throw new HttpError(409, "课堂已在其他窗口更新，请刷新后重试。");
  return classroom(owner, id);
}
export async function deleteClassroom(
  owner: string,
  id: string,
  revision: number,
) {
  await classroom(owner, id);
  const result = await db()
    .prepare(
      "UPDATE classrooms SET deleted_at=?,revision=revision+1 WHERE id=? AND owner=? AND deleted_at IS NULL AND revision=?",
    )
    .bind(new Date().toISOString(), id, owner, revision)
    .run();
  if (!result.meta.changes)
    throw new HttpError(409, "课堂已在其他窗口更新，请刷新后重试。");
  return { deleted: true };
}
export async function restoreClassroom(owner: string, id: string) {
  const result = await db()
    .prepare(
      "UPDATE classrooms SET deleted_at=NULL,revision=revision+1 WHERE id=? AND owner=? AND deleted_at IS NOT NULL",
    )
    .bind(id, owner)
    .run();
  if (!result.meta.changes) throw new HttpError(404, "回收站中未找到课堂。");
  return classroom(owner, id);
}
export async function listClassrooms(owner: string) {
  return (
    await db()
      .prepare(
        "SELECT id,title,created_at,revision FROM classrooms WHERE owner=? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 100",
      )
      .bind(owner)
      .all()
  ).results;
}
export async function classroom(owner: string, id: string) {
  const row = await db()
    .prepare(
      "SELECT id,title,created_at,notes,revision FROM classrooms WHERE id=? AND owner=? AND deleted_at IS NULL",
    )
    .bind(id, owner)
    .first<Classroom>();
  if (!row) throw new HttpError(404, "未找到课堂。");
  return row;
}
export async function createClassroom(owner: string, title: string) {
  const row = {
    id: crypto.randomUUID(),
    title,
    created_at: new Date().toISOString(),
    notes: "",
    revision: 0,
  };
  await db()
    .prepare(
      "INSERT INTO classrooms(id,owner,title,created_at) VALUES (?,?,?,?)",
    )
    .bind(row.id, owner, title, row.created_at)
    .run();
  return row;
}
export async function readClassroom(
  owner: string,
  id: string,
  cursor = 0,
  limit = 100,
) {
  const c = await classroom(owner, id);
  const rows =
    limit === 0
      ? { results: [] as Segment[] }
      : await db()
          .prepare(
            "SELECT seq,id,offset_ms,english,chinese,translation_group FROM segments WHERE classroom_id=? AND owner=? AND seq>? ORDER BY seq LIMIT ?",
          )
          .bind(id, owner, cursor, limit + 1)
          .all<
            Omit<Segment, "translation_group"> & { translation_group: string }
          >();
  const more = rows.results.length > limit;
  const items = rows.results.slice(0, limit);
  return {
    classroom: c,
    segments: items.map((s) => ({
      ...s,
      translation_group:
        typeof s.translation_group === "string"
          ? (JSON.parse(s.translation_group) as string[])
          : s.translation_group,
    })),
    analyses: await analysesFor(owner, id),
    nextCursor: more ? items[items.length - 1].seq : null,
  };
}
export async function readAnalyses(owner: string, id: string) {
  await classroom(owner, id);
  return analysesFor(owner, id);
}
async function analysesFor(owner: string, id: string) {
  return (
    await db()
      .prepare(
        "SELECT id,classroom_id,title,content,created_at FROM analyses WHERE classroom_id=? AND owner=? ORDER BY created_at DESC LIMIT 100",
      )
      .bind(id, owner)
      .all<Analysis>()
  ).results;
}
export async function saveNotes(
  owner: string,
  id: string,
  notes: string,
  revision: number,
) {
  await classroom(owner, id);
  const result = await db()
    .prepare(
      "UPDATE classrooms SET notes=?,revision=revision+1 WHERE id=? AND owner=? AND revision=? AND deleted_at IS NULL",
    )
    .bind(notes, id, owner, revision)
    .run();
  if (!result.meta.changes)
    throw new HttpError(
      409,
      "笔记已在其他窗口更新，请复制当前草稿后重新加载课堂。",
    );
  return classroom(owner, id);
}
export async function saveSegments(owner: string, id: string, rows: Segment[]) {
  await classroom(owner, id);
  await db().batch(
    rows.map((s) =>
      db()
        .prepare(
          "INSERT INTO segments(id,classroom_id,owner,offset_ms,english,chinese) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET chinese=CASE WHEN excluded.chinese<>'' AND segments.translation_group='[]' AND NOT EXISTS (SELECT 1 FROM segments AS anchor,json_each(anchor.translation_group) AS source WHERE anchor.classroom_id=segments.classroom_id AND anchor.owner=segments.owner AND anchor.id<>segments.id AND source.value=segments.id) THEN excluded.chinese ELSE segments.chinese END WHERE segments.owner=excluded.owner AND segments.classroom_id=excluded.classroom_id",
        )
        .bind(
          s.id,
          id,
          owner,
          s.offset_ms,
          s.english,
          s.translation_group?.length ? "" : s.chinese,
        ),
    ),
  );
  const claimed = new Set<string>();
  for (const s of rows.filter((row) => row.translation_group?.length)) {
    const ids = s.translation_group!;
    if (
      ids[0] !== s.id ||
      !s.chinese.trim() ||
      new Set(ids).size !== ids.length ||
      ids.some((source) => claimed.has(source))
    )
      throw new HttpError(400, "翻译分组无效。");
    ids.forEach((source) => claimed.add(source));
    const placeholders = ids.map(() => "?").join(",");
    const sources = await db()
      .prepare(
        `SELECT id,seq FROM segments WHERE classroom_id=? AND owner=? AND id IN (${placeholders}) ORDER BY seq`,
      )
      .bind(id, owner, ...ids)
      .all<{ id: string; seq: number }>();
    if (
      sources.results.length !== ids.length ||
      sources.results.some((source, i) => source.id !== ids[i])
    )
      throw new HttpError(409, "原文尚未全部同步，翻译分组将稍后重试。");
    const between = await db()
      .prepare(
        "SELECT COUNT(*) AS n FROM segments WHERE classroom_id=? AND owner=? AND seq BETWEEN ? AND ?",
      )
      .bind(id, owner, sources.results[0].seq, sources.results.at(-1)!.seq)
      .first<{ n: number }>();
    if (between?.n !== ids.length)
      throw new HttpError(400, "翻译只能合并相邻原文片段。");
    const groupJson = JSON.stringify(ids);
    const result = await db()
      .prepare(
        `UPDATE segments SET chinese=?,translation_group=? WHERE id=? AND classroom_id=? AND owner=? AND (translation_group='[]' OR translation_group=?) AND NOT EXISTS (SELECT 1 FROM segments AS other,json_each(other.translation_group) AS source WHERE other.classroom_id=? AND other.owner=? AND other.id<>? AND source.value IN (${placeholders}))`,
      )
      .bind(
        s.chinese,
        groupJson,
        s.id,
        id,
        owner,
        groupJson,
        id,
        owner,
        s.id,
        ...ids,
      )
      .run();
    if (!result.meta.changes)
      throw new HttpError(409, "原文已属于其他翻译分组，请重新加载课堂。");
  }
  return { saved: rows.length };
}
/** Atomically replace a whole translated window only if its previous contents still match. */
export async function refineTranslations(
  owner: string,
  id: string,
  expected: TranslationSnapshot[],
  groups: TranslationGroup[],
) {
  await classroom(owner, id);
  const ids = expected.map((r) => r.id);
  if (
    new Set(ids).size !== ids.length ||
    expected.some((r) =>
      (r.translation_group || []).some((source) => !ids.includes(source)),
    )
  )
    throw new HttpError(400, "整理必须包含完整的相邻翻译分组。");
  try {
    validateGroups(
      expected.map((r) => ({ id: r.id, text: "" })),
      groups,
      true,
    );
  } catch {
    throw new HttpError(400, "整理结果遗漏或重复了原文。");
  }
  const placeholders = ids.map(() => "?").join(",");
  const sources = await db()
    .prepare(
      `SELECT id,seq,chinese,translation_group FROM segments WHERE classroom_id=? AND owner=? AND id IN (${placeholders}) ORDER BY seq`,
    )
    .bind(id, owner, ...ids)
    .all<{
      id: string;
      seq: number;
      chinese: string;
      translation_group: string;
    }>();
  if (
    sources.results.length !== ids.length ||
    sources.results.some((r, i) => r.id !== ids[i])
  )
    throw new HttpError(409, "原文尚未同步或已更新，请重试整理。");
  const between = await db()
    .prepare(
      "SELECT COUNT(*) AS n FROM segments WHERE classroom_id=? AND owner=? AND seq BETWEEN ? AND ?",
    )
    .bind(id, owner, sources.results[0].seq, sources.results.at(-1)!.seq)
    .first<{ n: number }>();
  if (between?.n !== ids.length)
    throw new HttpError(400, "只能整理相邻原文片段。");
  const anchors = new Map(groups.map((g) => [g.ids[0], g]));
  const desired = ids.map((source) => ({
    id: source,
    chinese: anchors.get(source)?.translation || "",
    translation_group: anchors.get(source)?.ids || [],
  }));
  if (
    sources.results.every(
      (r, i) =>
        r.chinese === desired[i].chinese &&
        r.translation_group === JSON.stringify(desired[i].translation_group),
    )
  )
    return { saved: ids.length }; // A successful save whose response was lost may be retried.
  const result = await db()
    .prepare(
      `
    WITH expected AS (SELECT value FROM json_each(?)), desired AS (SELECT value FROM json_each(?)),
    permitted AS MATERIALIZED (
      SELECT 1 FROM classrooms WHERE id=? AND owner=? AND deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM expected AS e LEFT JOIN segments AS s
        ON s.id=json_extract(e.value,'$.id') AND s.classroom_id=? AND s.owner=?
        WHERE s.id IS NULL OR s.chinese<>json_extract(e.value,'$.chinese')
        OR s.translation_group<>json_extract(e.value,'$.translation_group')
      )
      AND NOT EXISTS (
        SELECT 1 FROM segments AS other,json_each(other.translation_group) AS source
        WHERE other.classroom_id=? AND other.owner=?
        AND source.value IN (SELECT json_extract(value,'$.id') FROM expected)
        AND other.id NOT IN (SELECT json_extract(value,'$.id') FROM expected)
      )
    )
    UPDATE segments SET
      chinese=(SELECT json_extract(value,'$.chinese') FROM desired WHERE json_extract(value,'$.id')=segments.id),
      translation_group=(SELECT json_extract(value,'$.translation_group') FROM desired WHERE json_extract(value,'$.id')=segments.id)
    WHERE classroom_id=? AND owner=? AND id IN (SELECT json_extract(value,'$.id') FROM desired)
    AND EXISTS (SELECT 1 FROM permitted)
  `,
    )
    .bind(
      JSON.stringify(
        expected.map((r) => ({
          ...r,
          translation_group: r.translation_group || [],
        })),
      ),
      JSON.stringify(desired),
      id,
      owner,
      id,
      owner,
      id,
      owner,
      id,
      owner,
    )
    .run();
  if (result.meta.changes !== ids.length)
    throw new HttpError(
      409,
      "译文已在其他窗口更新，保留当前译文，请重新载入课堂后整理。",
    );
  return { saved: ids.length };
}
export async function saveAnalysis(
  owner: string,
  id: string,
  requestId: string,
  title: string,
  content: string,
) {
  await classroom(owner, id);
  await db()
    .prepare(
      "INSERT INTO analyses(id,classroom_id,owner,title,content,created_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING",
    )
    .bind(requestId, id, owner, title, content, new Date().toISOString())
    .run();
  const result = await db()
    .prepare(
      "SELECT id,classroom_id,title,content,created_at FROM analyses WHERE id=? AND owner=? AND classroom_id=?",
    )
    .bind(requestId, owner, id)
    .first<Analysis>();
  if (!result)
    throw new HttpError(409, "操作标识冲突，请使用新的 request_id。");
  if (result.content !== content || result.title !== title)
    throw new HttpError(409, "该 request_id 已用于其他内容。");
  return result;
}
