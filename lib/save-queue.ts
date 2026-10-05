/** A shared save may contain an older draft. Drain again before committing post-edits. */
export async function drainSaves<T>(
  snapshot: () => ReadonlyMap<string, T>,
  flush: () => Promise<boolean>,
  isFlushing: () => boolean,
  targets?: ReadonlySet<string>,
) {
  const pending = () =>
    [...snapshot().keys()].some((id) => !targets || targets.has(id));
  while (pending()) {
    const before = new Map(snapshot());
    const joined = isFlushing();
    if (!(await flush())) return false;
    const after = snapshot();
    // Joining an older request need not remove the newly queued version.
    // A fresh successful request making no progress must not spin forever.
    if (
      !joined &&
      pending() &&
      before.size === after.size &&
      [...before].every(([id, value]) => after.get(id) === value)
    )
      return false;
  }
  return true;
}
