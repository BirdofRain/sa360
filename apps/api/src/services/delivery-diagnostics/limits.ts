/**
 * Abuse limits for diagnostics routes. The state is per API process, which is
 * enough to bound the load a leaked key can put on one instance. It is not a
 * shared quota across instances.
 */

export type RateLimiter = { take(key: string, now?: number): { allowed: boolean; retryAfterSeconds: number } };

export function createFixedWindowRateLimiter(input: { max: number; windowMs: number }): RateLimiter {
  const buckets = new Map<string, { start: number; count: number }>();
  return {
    take(key, now = Date.now()) {
      if (buckets.size > 1_000) {
        for (const [bucketKey, bucket] of buckets) {
          if (now - bucket.start >= input.windowMs) buckets.delete(bucketKey);
        }
      }
      const bucket = buckets.get(key);
      if (!bucket || now - bucket.start >= input.windowMs) {
        buckets.set(key, { start: now, count: 1 });
        return { allowed: true, retryAfterSeconds: 0 };
      }
      if (bucket.count >= input.max) {
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.start + input.windowMs - now) / 1000)) };
      }
      bucket.count += 1;
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}

export type ConcurrencyGate = {
  tryEnter(): (() => void) | null;
  inFlight(): number;
};

export function createConcurrencyGate(max: number): ConcurrencyGate {
  let active = 0;
  return {
    tryEnter() {
      if (active >= max) return null;
      active += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        active -= 1;
      };
    },
    inFlight: () => active,
  };
}

export const DIAGNOSTICS_RATE_LIMIT = { max: 30, windowMs: 60_000 } as const;
export const DIAGNOSTICS_MAX_CONCURRENT = 2;
