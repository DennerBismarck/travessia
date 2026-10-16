export function ttlCache<T>(ttlMs: number, now: () => number = Date.now) {
  let entry: { at: number; value: T } | null = null;
  let pending: Promise<T> | null = null;

  return (load: () => Promise<T>): Promise<T> => {
    if (entry && now() - entry.at < ttlMs) return Promise.resolve(entry.value);
    if (pending) return pending;
    pending = load()
      .then((value) => {
        entry = { at: now(), value };
        return value;
      })
      .finally(() => {
        pending = null;
      });
    return pending;
  };
}
