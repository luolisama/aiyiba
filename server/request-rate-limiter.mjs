export function createRequestRateLimiter(options = {}) {
  const windowMs = options.windowMs ?? 60_000;
  const limit = options.limit ?? 120;
  const maxEntries = options.maxEntries ?? 5_000;
  const now = options.now ?? (() => Date.now());
  const buckets = new Map();
  let nextCleanupAt = 0;

  function cleanup(current = now()) {
    let removed = 0;
    for (const [key, bucket] of buckets) {
      if (current - bucket.startedAt < windowMs) continue;
      buckets.delete(key);
      removed += 1;
    }
    nextCleanupAt = current + windowMs;
    return removed;
  }

  function consume(rawKey) {
    const current = now();
    if (current >= nextCleanupAt) cleanup(current);
    const key = String(rawKey || "unknown").slice(0, 160);
    const existing = buckets.get(key);
    if (!existing) {
      while (buckets.size >= maxEntries) buckets.delete(buckets.keys().next().value);
      buckets.set(key, { startedAt: current, count: 1 });
      return true;
    }
    existing.count += 1;
    return existing.count <= limit;
  }

  return { consume, cleanup, size: () => buckets.size };
}
