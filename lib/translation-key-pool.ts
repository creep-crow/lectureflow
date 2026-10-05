type KeySlot = { key: string; active: boolean; uses: number; cooldown: number };
type Lease = { slot: KeySlot; release: (failed: boolean) => void };
type Waiting = {
  exclude: Set<string>;
  resolve: (lease: Lease) => void;
  reject: (error: Error) => void;
};

/** Browser-local pool: one in-flight request per key, bounded parallelism, least-used idle key. */
export class TranslationKeyPool {
  private slots: KeySlot[];
  private waiting: Waiting[] = [];
  private active = 0;
  private cursor = 0;
  readonly concurrency: number;
  constructor(
    keys: string[],
    concurrency: number,
    private cooldownMs = 30000,
  ) {
    const unique = [...new Set(keys.map((k) => k.trim()).filter(Boolean))];
    this.slots = (unique.length ? unique : [""]).map((key) => ({
      key,
      active: false,
      uses: 0,
      cooldown: 0,
    }));
    this.concurrency = Math.min(
      this.slots.length,
      Math.max(1, Math.min(6, Math.floor(concurrency) || 1)),
    );
  }
  private drain() {
    for (let i = 0; i < this.waiting.length;) {
      const waiter = this.waiting[i];
      const candidates = this.slots.filter((s) => !waiter.exclude.has(s.key));
      if (
        !candidates.length ||
        candidates.every((s) => !s.active && s.cooldown > Date.now())
      ) {
        this.waiting.splice(i, 1);
        waiter.reject(
          new Error("可用翻译密钥暂时不足，请稍后重试或检查密钥额度。"),
        );
        continue;
      }
      const idle = candidates.filter(
        (s) => !s.active && s.cooldown <= Date.now(),
      );
      if (this.active >= this.concurrency || !idle.length) {
        i++;
        continue;
      }
      idle.sort(
        (a, b) =>
          a.uses - b.uses ||
          ((this.slots.indexOf(a) - this.cursor + this.slots.length) %
            this.slots.length) -
            ((this.slots.indexOf(b) - this.cursor + this.slots.length) %
              this.slots.length),
      );
      const slot = idle[0];
      slot.active = true;
      slot.uses++;
      this.active++;
      this.cursor = (this.slots.indexOf(slot) + 1) % this.slots.length;
      this.waiting.splice(i, 1);
      waiter.resolve({
        slot,
        release: (failed) => {
          slot.active = false;
          this.active--;
          if (failed) slot.cooldown = Date.now() + this.cooldownMs;
          this.drain();
        },
      });
    }
  }
  private acquire(exclude: Set<string>) {
    return new Promise<Lease>((resolve, reject) => {
      this.waiting.push({ exclude, resolve, reject });
      this.drain();
    });
  }
  async run<T>(operation: (key: string) => Promise<T>): Promise<T> {
    const tried = new Set<string>();
    let last: unknown;
    for (let attempt = 0; attempt < Math.min(3, this.slots.length); attempt++) {
      let lease: Lease;
      try {
        lease = await this.acquire(tried);
      } catch (e) {
        throw last || e;
      }
      tried.add(lease.slot.key);
      try {
        const result = await operation(lease.slot.key);
        lease.release(false);
        return result;
      } catch (e) {
        const status = (e as { status?: number })?.status;
        const retryable =
          status === 0 ||
          status === 429 ||
          (typeof status === "number" && status >= 500);
        lease.release(retryable);
        if (!retryable) throw e;
        last = e;
      }
    }
    throw last;
  }
}
