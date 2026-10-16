/**
 * Login failure window for the Meta App Reviewer form.
 *
 * DigitalOcean App Platform's client address is the `do-connecting-ip` header
 * it adds. `X-Forwarded-For` is the ingress address, and `X-Real-IP` is not
 * part of that contract. Neither is used: a caller can supply both and mint a
 * fresh budget per guess.
 *
 * A missing or malformed platform header shares one bucket, so omitting the
 * header is not a bypass. Each process also has a ceiling across every
 * address. App Platform instances do not share memory, so the deploy keeps
 * admin-coc at one instance; a second instance multiplies this window.
 * When the table is full, new addresses are limited instead of ignored.
 */

import { isIP } from "node:net";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 8;
const GLOBAL_MAX_FAILURES = 32;
const MAX_KEYS = 4096;
const GLOBAL_KEY = "__global__";

/** Requests without a single platform client IP share this bucket. */
export const META_REVIEWER_LOGIN_UNTRUSTED_RATE_KEY = "untrusted";

const TRUSTED_CLIENT_IP_HEADER = "do-connecting-ip";

type Bucket = { failures: number; resetAt: number };

const buckets = new Map<string, Bucket>();

function normalizePlatformIp(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 64 || trimmed.includes(",")) return null;
  const withoutBrackets =
    trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed.slice(1, -1) : trimmed;
  if (isIP(withoutBrackets) === 0) return null;
  return withoutBrackets.toLowerCase();
}

export function metaReviewerLoginRateKey(headerList: { get(name: string): string | null }): string {
  const platformIp = normalizePlatformIp(headerList.get(TRUSTED_CLIENT_IP_HEADER) ?? "");
  return platformIp ?? META_REVIEWER_LOGIN_UNTRUSTED_RATE_KEY;
}

function liveBucket(key: string, now: number): Bucket | undefined {
  const bucket = buckets.get(key);
  if (!bucket) return undefined;
  if (bucket.resetAt <= now) {
    buckets.delete(key);
    return undefined;
  }
  return bucket;
}

function failures(key: string, now: number): number {
  return liveBucket(key, now)?.failures ?? 0;
}

export function metaReviewerLoginRateLimited(key: string, now = Date.now()): boolean {
  if (failures(GLOBAL_KEY, now) >= GLOBAL_MAX_FAILURES) return true;
  if (!liveBucket(key, now) && buckets.size >= MAX_KEYS) return true;
  return failures(key, now) >= MAX_FAILURES;
}

function bump(key: string, now: number): void {
  const existing = liveBucket(key, now);
  if (!existing) {
    if (buckets.size >= MAX_KEYS) {
      const global = liveBucket(GLOBAL_KEY, now);
      if (global) global.failures = Math.max(global.failures, GLOBAL_MAX_FAILURES);
      return;
    }
    buckets.set(key, { failures: 1, resetAt: now + WINDOW_MS });
    return;
  }
  existing.failures += 1;
}

export function recordMetaReviewerLoginFailure(key: string, now = Date.now()): void {
  bump(GLOBAL_KEY, now);
  if (key !== GLOBAL_KEY) bump(key, now);
}

export function clearMetaReviewerLoginFailures(key: string): void {
  buckets.delete(key);
}

export function resetMetaReviewerLoginRateLimitForTests(): void {
  buckets.clear();
}
