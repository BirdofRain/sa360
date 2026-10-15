/**
 * In-memory login failure window for the Meta App Reviewer form.
 * One Admin C.O.C. instance. Fail closed once the per-key budget is spent.
 * Keys are client addresses, never passwords, and are not logged.
 */

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 8;
const MAX_KEYS = 4096;

type Bucket = { failures: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export function metaReviewerLoginRateKey(headerList: { get(name: string): string | null }): string {
  const forwarded = headerList.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim() ?? "";
  const candidate = first || headerList.get("x-real-ip")?.trim() || "";
  if (!candidate || candidate.length > 64 || !/^[0-9a-fA-F:.]+$/.test(candidate)) return "unknown";
  return candidate;
}

export function metaReviewerLoginRateLimited(key: string, now = Date.now()): boolean {
  const bucket = buckets.get(key);
  if (!bucket) return false;
  if (bucket.resetAt <= now) {
    buckets.delete(key);
    return false;
  }
  return bucket.failures >= MAX_FAILURES;
}

export function recordMetaReviewerLoginFailure(key: string, now = Date.now()): void {
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    if (!existing && buckets.size >= MAX_KEYS) return;
    buckets.set(key, { failures: 1, resetAt: now + WINDOW_MS });
    return;
  }
  existing.failures += 1;
}

export function clearMetaReviewerLoginFailures(key: string): void {
  buckets.delete(key);
}

export function resetMetaReviewerLoginRateLimitForTests(): void {
  buckets.clear();
}
