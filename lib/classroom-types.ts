export type Classroom = {
  id: string;
  title: string;
  created_at: string;
  notes: string;
  revision: number;
  deleted_at?: string | null;
};
export type ClassroomRecord = Classroom & {
  segment_count: number;
  analysis_count: number;
  has_notes: number;
  excerpt: string | null;
};
export type Segment = {
  seq?: number;
  id: string;
  offset_ms: number;
  english: string;
  chinese: string;
  translationError?: boolean;
  refinementError?: boolean;
  /** Raw fragment IDs translated together; only the first fragment stores this. */
  translation_group?: string[];
};
export type Analysis = {
  id: string;
  classroom_id: string;
  title: string;
  content: string;
  created_at: string;
};
export type ClassroomData = {
  classroom: Classroom;
  segments: Segment[];
  analyses: Analysis[];
  nextCursor: number | null;
};
export const LIVE_MODEL = "gemini-3.5-transcribe-live";
export const TRANSLATION_MODEL = "deepseek-flash";
export const formatTime = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60]
    .slice(s >= 3600 ? 0 : 1)
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
};
