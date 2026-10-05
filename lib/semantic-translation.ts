export type Fragment = { id: string; text: string };
export type TranslationGroup = { ids: string[]; translation: string };

/** Validate exact, ordered coverage of a prefix. The model never rewrites English. */
export function validateGroups(
  fragments: Fragment[],
  groups: TranslationGroup[],
  force = false,
) {
  let consumed = 0;
  for (const group of groups) {
    if (
      !group.ids.length ||
      !group.translation.trim() ||
      group.translation.length > 16000
    )
      throw new Error("无效的语义翻译结果。");
    for (const id of group.ids) {
      if (fragments[consumed]?.id !== id)
        throw new Error("断句结果遗漏或重复了原文，请重试。");
      consumed++;
    }
  }
  if (force && consumed !== fragments.length)
    throw new Error("最后一段翻译不完整，请重试。");
  return consumed;
}

type Callbacks = {
  concurrency?: () => number;
  request: (
    fragments: Fragment[],
    force: boolean,
  ) => Promise<TranslationGroup[]>;
  onGroup: (group: TranslationGroup) => void;
  onPending: (count: number, waiting: boolean) => void;
  onError: (message: string, ids: string[]) => void;
};

/** Parallelize bounded backlog windows; keep the unfinished trailing window for continuation. */
export class SemanticTranslator {
  private pending: (Fragment & { received: number })[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  private working?: Promise<void>;
  private finishing?: Promise<void>;
  private failed = false;
  private disposed = false;
  constructor(
    private callbacks: Callbacks,
    private timing = { debounce: 2500, maxWait: 18000 },
  ) {}
  has(id: string) {
    return this.pending.some((p) => p.id === id);
  }
  append(fragment: Fragment) {
    if (this.disposed || this.has(fragment.id)) return;
    this.pending.push({ ...fragment, received: Date.now() });
    this.failed = false;
    this.callbacks.onPending(this.pending.length, true);
    this.schedule();
  }
  private schedule(waitForMore = false) {
    clearTimeout(this.timer);
    if (!this.pending.length || this.disposed || this.failed || this.finishing)
      return;
    const remaining =
      this.timing.maxWait - (Date.now() - this.pending[0].received);
    this.timer = setTimeout(
      () => void this.process(remaining <= 0 || waitForMore),
      Math.max(
        0,
        waitForMore ? remaining : Math.min(this.timing.debounce, remaining),
      ),
    );
  }
  private async process(force: boolean) {
    if (this.working) {
      await this.working;
      return;
    }
    if (!this.pending.length || this.disposed) return;
    const jobs: { snapshot: Fragment[]; force: boolean }[] = [];
    let offset = 0;
    const concurrency = Math.max(
      1,
      Math.min(6, this.callbacks.concurrency?.() || 1),
    );
    while (offset < this.pending.length && jobs.length < concurrency) {
      const snapshot: Fragment[] = [];
      let size = 0;
      for (const fragment of this.pending.slice(offset, offset + 20)) {
        if (size + fragment.text.length + 1 > 12000 && snapshot.length) break;
        snapshot.push({ id: fragment.id, text: fragment.text });
        size += fragment.text.length + 1;
      }
      const bounded = snapshot.length === 20 || size >= 10000;
      jobs.push({ snapshot, force: force || bounded });
      offset += snapshot.length;
      // Only backlog windows or an explicit stop may start another parallel batch.
      if (!force && !bounded) break;
    }
    this.callbacks.onPending(this.pending.length, false);
    let consumed = 0;
    this.working = (async () => {
      const results = await Promise.all(
        jobs.map(async (job) => {
          try {
            const groups = await this.callbacks.request(
              job.snapshot,
              job.force,
            );
            return {
              job,
              groups,
              consumed: validateGroups(job.snapshot, groups, job.force),
            };
          } catch (error) {
            return { job, error };
          }
        }),
      );
      if (this.disposed) return;
      const committed = new Set<string>();
      this.failed = false;
      // Publish in source order even when network responses finish out of order.
      for (const result of results) {
        if ("error" in result) {
          this.failed = true;
          this.callbacks.onError(
            result.error instanceof Error
              ? result.error.message
              : "语义翻译失败，请重试。",
            result.job.snapshot.map((f) => f.id),
          );
        } else {
          for (const group of result.groups) this.callbacks.onGroup(group);
          consumed += result.consumed;
          for (const f of result.job.snapshot.slice(0, result.consumed))
            committed.add(f.id);
        }
      }
      this.pending = this.pending.filter((f) => !committed.has(f.id));
    })();
    await this.working;
    this.working = undefined;
    if (!this.disposed) {
      this.callbacks.onPending(
        this.failed ? 0 : this.pending.length,
        !!this.pending.length && !this.failed,
      );
      this.schedule(consumed === 0 && this.pending.length === offset);
    }
  }
  finish() {
    if (this.finishing) return this.finishing;
    clearTimeout(this.timer);
    this.finishing = (async () => {
      await this.working;
      this.failed = false;
      while (this.pending.length && !this.disposed && !this.failed)
        await this.process(true);
    })().finally(() => {
      this.finishing = undefined;
    });
    return this.finishing;
  }
  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
  }
}

/** Group the display only. All original fragments remain stored unchanged. */
export function displaySegments<
  T extends {
    id: string;
    english: string;
    chinese: string;
    translation_group?: string[];
  },
>(rows: T[]): T[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const covered = new Set<string>();
  for (const row of rows) {
    const ids = row.translation_group;
    if (ids?.[0] === row.id && ids.every((id) => byId.has(id)))
      for (const id of ids.slice(1)) covered.add(id);
  }
  return rows
    .filter((r) => !covered.has(r.id))
    .map((row) => {
      const ids = row.translation_group;
      if (!ids?.length || ids[0] !== row.id || !ids.every((id) => byId.has(id)))
        return row;
      return {
        ...row,
        english: ids.map((id) => byId.get(id)!.english).join(" "),
      };
    });
}
