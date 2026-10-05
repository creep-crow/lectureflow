import type { Segment } from "./classroom-types";
import {
  displaySegments,
  validateGroups,
  type Fragment,
  type TranslationGroup,
} from "./semantic-translation";

export type CompletedTranslation = { english: string; chinese: string };
export type TranslationSnapshot = Pick<
  Segment,
  "id" | "chinese" | "translation_group"
>;
export type RefinementWindow = {
  fragments: Fragment[];
  expected: TranslationSnapshot[];
  drafts: { id: string; ids: string[]; translation: string }[];
  context: CompletedTranslation[];
};

/** Only completed nearby translations are sent; never notes, credentials or another classroom. */
export function completedContext(rows: Segment[], beforeId: string) {
  const before = rows.findIndex((r) => r.id === beforeId);
  const result: CompletedTranslation[] = [];
  let size = 0;
  for (const row of displaySegments(
    rows.slice(0, Math.max(0, before)),
  ).reverse()) {
    if (!row.chinese) continue;
    const item = { english: row.english, chinese: row.chinese };
    const length = JSON.stringify(item).length;
    if (size + length > 11000 || result.length === 8) break;
    result.unshift(item);
    size += length;
  }
  return result;
}

/** Revisit whole existing groups, including the preceding thought, never half of a group. */
export function refinementWindow(
  rows: Segment[],
  dirty: Set<string>,
): RefinementWindow | undefined {
  const units = displaySegments(rows);
  const first = units.findIndex(
    (r) =>
      r.chinese &&
      (r.translation_group?.length ? r.translation_group : [r.id]).some((id) =>
        dirty.has(id),
      ),
  );
  if (first < 0) return;
  let start = first;
  while (start > Math.max(0, first - 2) && units[start - 1].chinese) start--;
  let selected: Segment[] = [];
  let size = 0;
  for (const unit of units.slice(start)) {
    if (!unit.chinese) break;
    const ids = unit.translation_group?.length
      ? unit.translation_group
      : [unit.id];
    const sources = ids.map((id) => rows.find((r) => r.id === id)!);
    const nextSize = sources.reduce((n, r) => n + r.english.length, 0);
    if (
      selected.length + ids.length > 20 ||
      size + nextSize > 12000 ||
      selected.reduce((n, r) => n + r.chinese.length, 0) +
        sources.reduce((n, r) => n + r.chinese.length, 0) >
        32000
    )
      break;
    selected = selected.concat(sources);
    size += nextSize;
    if (selected.some((r) => dirty.has(r.id)) && selected.length >= 12) break;
  }
  // An older large group may consume the window. Retry from the dirty unit instead.
  if (!selected.some((r) => dirty.has(r.id)) && start < first) {
    const window = refinementWindow(
      rows.slice(rows.findIndex((r) => r.id === units[first].id)),
      dirty,
    );
    if (window) window.context = completedContext(rows, window.fragments[0].id);
    return window;
  }
  if (!selected.length || !selected.some((r) => dirty.has(r.id))) return;
  return {
    fragments: selected.map((r) => ({ id: r.id, text: r.english })),
    expected: selected.map((r) => ({
      id: r.id,
      chinese: r.chinese,
      translation_group: r.translation_group || [],
    })),
    drafts: selected
      .filter((r) => r.chinese)
      .map((r) => ({
        id: r.id,
        ids: r.translation_group?.length ? r.translation_group : [r.id],
        translation: r.chinese,
      })),
    context: completedContext(rows, selected[0].id),
  };
}
export function snapshotMatches(
  rows: Segment[],
  expected: TranslationSnapshot[],
) {
  return expected.every((prior) => {
    const row = rows.find((r) => r.id === prior.id);
    return (
      row &&
      row.chinese === prior.chinese &&
      JSON.stringify(row.translation_group || []) ===
        JSON.stringify(prior.translation_group || [])
    );
  });
}
export function applyRefinement(
  rows: Segment[],
  expected: TranslationSnapshot[],
  groups: TranslationGroup[],
) {
  if (!snapshotMatches(rows, expected)) return rows;
  validateGroups(
    expected.map((r) => ({ id: r.id, text: "" })),
    groups,
    true,
  );
  const affected = new Set(expected.map((r) => r.id));
  const anchors = new Map(groups.map((g) => [g.ids[0], g]));
  return rows.map((row) => {
    if (!affected.has(row.id)) return row;
    const group = anchors.get(row.id);
    return {
      ...row,
      chinese: group?.translation || "",
      translation_group: group?.ids || [],
      translationError: false,
      refinementError: false,
    };
  });
}

type Callbacks = {
  concurrency: () => number;
  snapshot: () => Segment[];
  translate: (
    fragment: Fragment,
    context: CompletedTranslation[],
  ) => Promise<string>;
  refine: (window: RefinementWindow) => Promise<TranslationGroup[]>;
  onDraft: (fragment: Fragment, translation: string) => void;
  onRefined: (
    window: RefinementWindow,
    groups: TranslationGroup[],
  ) => Promise<void>;
  onPending: (drafts: number, refining: boolean) => void;
  onError: (message: string, ids: string[], stage: "draft" | "refine") => void;
};

/** Dispatch primary translation immediately. Polish only after drafts are visible. */
export class FastTranslator {
  private pending = new Map<
    string,
    { fragment: Fragment; state: "queued" | "active" | "failed" }
  >();
  private tasks = new Set<Promise<void>>();
  private dirty = new Set<string>();
  private refineTask?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  private dirtySince = 0;
  private refineFailed = false;
  private disposed = false;
  private finishing?: Promise<void>;
  constructor(
    private callbacks: Callbacks,
    private timing = { debounce: 1500, maxWait: 6000 },
  ) {}
  has(id: string) {
    return this.pending.has(id);
  }
  append(fragment: Fragment) {
    if (this.disposed || this.has(fragment.id)) return;
    this.pending.set(fragment.id, { fragment, state: "queued" });
    this.pump();
  }
  private notify() {
    if (this.disposed) return;
    this.callbacks.onPending(
      [...this.pending.values()].filter((r) => r.state !== "failed").length,
      !!this.refineTask || (!!this.dirty.size && !this.refineFailed),
    );
  }
  private pump() {
    if (this.disposed) return;
    const limit = Math.max(1, Math.min(6, this.callbacks.concurrency()));
    for (const item of this.pending.values()) {
      if (this.tasks.size >= limit) break;
      if (item.state !== "queued") continue;
      item.state = "active";
      const context = completedContext(
        this.callbacks.snapshot(),
        item.fragment.id,
      );
      // Invocation precedes any segmentation timer, including for unfinished clauses.
      const request = this.callbacks.translate(item.fragment, context);
      const task = (async () => {
        try {
          const translation = await request;
          if (this.disposed) return;
          if (!translation.trim() || translation.length > 16000)
            throw new Error("初译内容为空或过长。");
          this.callbacks.onDraft(item.fragment, translation);
          this.pending.delete(item.fragment.id);
          this.dirty.add(item.fragment.id);
          this.dirtySince ||= Date.now();
          this.refineFailed = false;
        } catch (error) {
          if (this.disposed) return;
          item.state = "failed";
          this.callbacks.onError(
            error instanceof Error ? error.message : "翻译失败。",
            [item.fragment.id],
            "draft",
          );
        }
      })().finally(() => {
        this.tasks.delete(task);
        if (!this.disposed) {
          this.pump();
          this.scheduleRefinement();
          this.notify();
        }
      });
      this.tasks.add(task);
    }
    this.notify();
  }
  private scheduleRefinement() {
    clearTimeout(this.timer);
    if (
      this.disposed ||
      this.finishing ||
      this.refineTask ||
      this.refineFailed ||
      !this.dirty.size ||
      this.tasks.size
    )
      return;
    this.timer = setTimeout(
      () => void this.polish(),
      Math.max(
        0,
        Math.min(
          this.timing.debounce,
          this.timing.maxWait - (Date.now() - this.dirtySince),
        ),
      ),
    );
  }
  private polish() {
    if (this.refineTask) return this.refineTask;
    if (this.disposed || !this.dirty.size) return Promise.resolve();
    const window = refinementWindow(this.callbacks.snapshot(), this.dirty);
    if (!window) return Promise.resolve(); // A failed initial translation separates windows.
    const ids = window.fragments.map((f) => f.id);
    const task = (async () => {
      try {
        const groups = await this.callbacks.refine(window);
        if (this.disposed) return;
        validateGroups(window.fragments, groups, true);
        if (!snapshotMatches(this.callbacks.snapshot(), window.expected))
          return;
        await this.callbacks.onRefined(window, groups);
        ids.forEach((id) => this.dirty.delete(id));
        this.dirtySince = this.dirty.size ? Date.now() : 0;
      } catch (error) {
        if (this.disposed) return;
        this.refineFailed = true;
        this.callbacks.onError(
          error instanceof Error ? error.message : "译文整理失败。",
          ids,
          "refine",
        );
      }
    })().finally(() => {
      this.refineTask = undefined;
      this.scheduleRefinement();
      this.notify();
    });
    this.refineTask = task;
    this.notify();
    return task;
  }
  retryRefinement(id: string) {
    this.retryRefinements([id]);
  }
  retryRefinements(ids: string[]) {
    if (this.disposed || !ids.length) return;
    ids.forEach((id) => this.dirty.add(id));
    this.dirtySince ||= Date.now();
    this.refineFailed = false;
    void this.polish();
  }
  finish() {
    if (this.finishing) return this.finishing;
    clearTimeout(this.timer);
    for (const item of this.pending.values())
      if (item.state === "failed") item.state = "queued";
    this.pump();
    this.finishing = (async () => {
      while (this.tasks.size && !this.disposed)
        await Promise.all([...this.tasks]);
      await this.refineTask;
      // Failed initial translations and failed polishing are retried explicitly.
      while (this.dirty.size && !this.refineFailed && !this.disposed) {
        const before = this.dirty.size;
        await this.polish();
        if (this.dirty.size === before) break;
      }
    })().finally(() => {
      this.finishing = undefined;
      this.notify();
    });
    return this.finishing;
  }
  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
  }
}
