import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
export const classrooms = sqliteTable(
  "classrooms",
  {
    id: text("id").primaryKey(),
    owner: text("owner").notNull(),
    title: text("title").notNull(),
    createdAt: text("created_at").notNull(),
    notes: text("notes").notNull().default(""),
    revision: integer("revision").notNull().default(0),
    deletedAt: text("deleted_at"),
  },
  (t) => [index("idx_classrooms_owner_created").on(t.owner, t.createdAt)],
);
export const segments = sqliteTable(
  "segments",
  {
    seq: integer("seq").primaryKey({ autoIncrement: true }),
    id: text("id").notNull().unique(),
    classroomId: text("classroom_id")
      .notNull()
      .references(() => classrooms.id),
    owner: text("owner").notNull(),
    offsetMs: integer("offset_ms").notNull(),
    english: text("english").notNull(),
    chinese: text("chinese").notNull().default(""),
    translationGroup: text("translation_group").notNull().default("[]"),
  },
  (t) => [index("idx_segments_classroom_seq").on(t.classroomId, t.seq)],
);
export const analyses = sqliteTable(
  "analyses",
  {
    id: text("id").primaryKey(),
    classroomId: text("classroom_id")
      .notNull()
      .references(() => classrooms.id),
    owner: text("owner").notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("idx_analyses_classroom_created").on(t.classroomId, t.createdAt),
  ],
);
