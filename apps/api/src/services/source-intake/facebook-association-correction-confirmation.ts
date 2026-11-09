import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Pure confirmation snapshot for a future association-only correction.
 * The signature is not a writer, a route, or permission to change production.
 * The unsigned preview digest is not accepted as authorization.
 */

export const CONFIRMATION_SNAPSHOT_VERSION = 1 as const;
export const CONFIRMATION_SNAPSHOT_PURPOSE = "facebook_association_correction" as const;
export const CONFIRMATION_ACKNOWLEDGEMENT = "association_only" as const;
export const CONFIRMATION_SNAPSHOT_TTL_MS = 15 * 60 * 1000;
export const CONFIRMATION_SNAPSHOT_SECRET_ENV = "SA360_ASSOCIATION_CORRECTION_SNAPSHOT_SECRET";
const MIN_SECRET_LENGTH = 32;
const FINGERPRINT_PATTERN = /^[0-9a-f]{16}$/;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const CONFIRMED_AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

const BODY_KEYS = [
  "acknowledgement",
  "confirmedAt",
  "eventCount",
  "events",
  "expiresAt",
  "formId",
  "issuedAt",
  "originClientAccountId",
  "pageId",
  "previewDigest",
  "purpose",
  "sourceFunnelId",
  "v",
] as const;

export const CONFIRMATION_VERIFICATION_CODES = [
  "unknown_version",
  "malformed",
  "not_canonical",
  "count_mismatch",
  "acknowledgement_rejected",
  "invalid_signature",
  "issued_in_future",
  "expired",
  "cohort_mismatch",
  "event_set_mismatch",
  "fingerprint_mismatch",
  "preview_digest_mismatch",
] as const;

export type ConfirmationVerificationCode = (typeof CONFIRMATION_VERIFICATION_CODES)[number];

export type ConfirmationSnapshotEvent = {
  sourceEventId: string;
  fingerprint: string;
};

export type ConfirmationSnapshotBody = {
  v: typeof CONFIRMATION_SNAPSHOT_VERSION;
  purpose: typeof CONFIRMATION_SNAPSHOT_PURPOSE;
  sourceFunnelId: string;
  pageId: string;
  formId: string;
  originClientAccountId: string;
  confirmedAt: string;
  previewDigest: string;
  eventCount: number;
  events: ConfirmationSnapshotEvent[];
  issuedAt: string;
  expiresAt: string;
  acknowledgement: typeof CONFIRMATION_ACKNOWLEDGEMENT;
};

export type SignedConfirmationSnapshot = {
  body: ConfirmationSnapshotBody;
  signature: string;
};

export type ConfirmationExpectation = {
  sourceFunnelId: string;
  pageId: string;
  formId: string;
  originClientAccountId: string;
  confirmedAt: string;
  previewDigest: string;
  events: ConfirmationSnapshotEvent[];
  acknowledgement: typeof CONFIRMATION_ACKNOWLEDGEMENT;
};

export type ConfirmationVerification =
  | { ok: true; body: ConfirmationSnapshotBody }
  | { ok: false; code: ConfirmationVerificationCode };

export class ConfirmationSnapshotError extends Error {
  constructor(readonly code: "secret_unavailable" | "acknowledgement_rejected" | "malformed") {
    super(code);
    this.name = "ConfirmationSnapshotError";
  }
}

export function readConfirmationSnapshotSecret(
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const value = env[CONFIRMATION_SNAPSHOT_SECRET_ENV]?.trim();
  if (!value || value.length < MIN_SECRET_LENGTH) return null;
  return value;
}

export function canonicalConfirmationSnapshot(body: ConfirmationSnapshotBody): string {
  return canonicalJson(body);
}

export function signConfirmationSnapshot(input: {
  sourceFunnelId: string;
  pageId: string;
  formId: string;
  originClientAccountId: string;
  confirmedAt: string;
  previewDigest: string;
  events: ConfirmationSnapshotEvent[];
  acknowledgement: string;
  secret: string;
  now: Date;
}): SignedConfirmationSnapshot {
  if (input.secret.trim().length < MIN_SECRET_LENGTH) {
    throw new ConfirmationSnapshotError("secret_unavailable");
  }
  if (input.acknowledgement !== CONFIRMATION_ACKNOWLEDGEMENT) {
    throw new ConfirmationSnapshotError("acknowledgement_rejected");
  }
  const issuedAt = input.now.toISOString();
  const body: ConfirmationSnapshotBody = {
    v: CONFIRMATION_SNAPSHOT_VERSION,
    purpose: CONFIRMATION_SNAPSHOT_PURPOSE,
    sourceFunnelId: requiredToken(input.sourceFunnelId, 40),
    pageId: requiredToken(input.pageId, 32),
    formId: requiredToken(input.formId, 32),
    originClientAccountId: requiredToken(input.originClientAccountId, 80),
    confirmedAt: requiredInstant(input.confirmedAt),
    previewDigest: requiredDigest(input.previewDigest),
    eventCount: input.events.length,
    events: canonicalEvents(input.events),
    issuedAt,
    expiresAt: new Date(input.now.getTime() + CONFIRMATION_SNAPSHOT_TTL_MS).toISOString(),
    acknowledgement: CONFIRMATION_ACKNOWLEDGEMENT,
  };
  return { body, signature: signCanonical(canonicalConfirmationSnapshot(body), input.secret) };
}

/**
 * Signs the exact canonical string. Used to prove that a body this signer
 * would refuse, such as an unknown version, still fails closed at verification.
 */
export function signConfirmationCanonical(canonical: string, secret: string): string {
  if (secret.trim().length < MIN_SECRET_LENGTH) {
    throw new ConfirmationSnapshotError("secret_unavailable");
  }
  return signCanonical(canonical, secret);
}

export function verifyConfirmationSnapshot(input: {
  snapshot: unknown;
  secret: string;
  now: Date;
  expected: ConfirmationExpectation;
}): ConfirmationVerification {
  const parsed = parseSnapshot(input.snapshot);
  if (!parsed.ok) return parsed;
  if (input.secret.trim().length < MIN_SECRET_LENGTH) {
    return { ok: false, code: "invalid_signature" };
  }
  const signed = fixedEqual(
    parsed.signature,
    signCanonical(canonicalConfirmationSnapshot(parsed.body), input.secret)
  );
  if (!signed) return { ok: false, code: "invalid_signature" };

  const issuedAt = Date.parse(parsed.body.issuedAt);
  const expiresAt = Date.parse(parsed.body.expiresAt);
  if (issuedAt > input.now.getTime()) return { ok: false, code: "issued_in_future" };
  if (expiresAt <= input.now.getTime()) return { ok: false, code: "expired" };

  if (
    parsed.body.sourceFunnelId !== input.expected.sourceFunnelId ||
    parsed.body.pageId !== input.expected.pageId ||
    parsed.body.formId !== input.expected.formId ||
    parsed.body.originClientAccountId !== input.expected.originClientAccountId ||
    parsed.body.confirmedAt !== input.expected.confirmedAt
  ) {
    return { ok: false, code: "cohort_mismatch" };
  }
  if (parsed.body.acknowledgement !== input.expected.acknowledgement) {
    return { ok: false, code: "acknowledgement_rejected" };
  }
  if (parsed.body.previewDigest !== input.expected.previewDigest) {
    return { ok: false, code: "preview_digest_mismatch" };
  }
  const expectedEvents = canonicalEvents(input.expected.events);
  if (parsed.body.eventCount !== expectedEvents.length || parsed.body.events.length !== expectedEvents.length) {
    return { ok: false, code: "event_set_mismatch" };
  }
  for (let index = 0; index < expectedEvents.length; index += 1) {
    const actual = parsed.body.events[index];
    const expected = expectedEvents[index];
    if (!actual || actual.sourceEventId !== expected.sourceEventId) {
      return { ok: false, code: "event_set_mismatch" };
    }
    if (actual.fingerprint !== expected.fingerprint) {
      return { ok: false, code: "fingerprint_mismatch" };
    }
  }
  return { ok: true, body: parsed.body };
}

function parseSnapshot(
  snapshot: unknown
): { ok: true; body: ConfirmationSnapshotBody; signature: string } | { ok: false; code: ConfirmationVerificationCode } {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return { ok: false, code: "malformed" };
  }
  const envelope = snapshot as Record<string, unknown>;
  if (!sameKeys(envelope, ["body", "signature"])) return { ok: false, code: "malformed" };
  if (typeof envelope.signature !== "string" || !/^[0-9a-f]{64}$/.test(envelope.signature)) {
    return { ok: false, code: "malformed" };
  }
  const rawBody = envelope.body;
  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    return { ok: false, code: "malformed" };
  }
  const body = rawBody as Record<string, unknown>;
  if (body.v !== CONFIRMATION_SNAPSHOT_VERSION) return { ok: false, code: "unknown_version" };
  if (!sameKeys(body, BODY_KEYS)) return { ok: false, code: "malformed" };
  if (body.purpose !== CONFIRMATION_SNAPSHOT_PURPOSE) return { ok: false, code: "malformed" };
  if (body.acknowledgement !== CONFIRMATION_ACKNOWLEDGEMENT) {
    return { ok: false, code: "acknowledgement_rejected" };
  }
  if (
    !isToken(body.sourceFunnelId, 40) ||
    !isToken(body.pageId, 32) ||
    !isToken(body.formId, 32) ||
    !isToken(body.originClientAccountId, 80) ||
    typeof body.confirmedAt !== "string" ||
    !CONFIRMED_AT_PATTERN.test(body.confirmedAt) ||
    typeof body.previewDigest !== "string" ||
    !DIGEST_PATTERN.test(body.previewDigest) ||
    typeof body.issuedAt !== "string" ||
    typeof body.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(body.issuedAt)) ||
    !Number.isFinite(Date.parse(body.expiresAt))
  ) {
    return { ok: false, code: "malformed" };
  }
  if (!Array.isArray(body.events) || body.eventCount !== body.events.length) {
    return { ok: false, code: "count_mismatch" };
  }
  const events: ConfirmationSnapshotEvent[] = [];
  for (const entry of body.events) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return { ok: false, code: "malformed" };
    const event = entry as Record<string, unknown>;
    if (!sameKeys(event, ["fingerprint", "sourceEventId"])) return { ok: false, code: "malformed" };
    if (!isToken(event.sourceEventId, 40) || typeof event.fingerprint !== "string" || !FINGERPRINT_PATTERN.test(event.fingerprint)) {
      return { ok: false, code: "malformed" };
    }
    events.push({ sourceEventId: event.sourceEventId, fingerprint: event.fingerprint });
  }
  const sorted = [...events].sort((a, b) => a.sourceEventId.localeCompare(b.sourceEventId));
  if (events.some((event, index) => event.sourceEventId !== sorted[index]?.sourceEventId)) {
    return { ok: false, code: "not_canonical" };
  }
  if (new Set(events.map((event) => event.sourceEventId)).size !== events.length) {
    return { ok: false, code: "malformed" };
  }
  const issuedAt = Date.parse(body.issuedAt);
  const expiresAt = Date.parse(body.expiresAt);
  if (expiresAt !== issuedAt + CONFIRMATION_SNAPSHOT_TTL_MS) return { ok: false, code: "malformed" };
  return {
    ok: true,
    signature: envelope.signature,
    body: {
      v: CONFIRMATION_SNAPSHOT_VERSION,
      purpose: CONFIRMATION_SNAPSHOT_PURPOSE,
      sourceFunnelId: body.sourceFunnelId,
      pageId: body.pageId,
      formId: body.formId,
      originClientAccountId: body.originClientAccountId,
      confirmedAt: body.confirmedAt,
      previewDigest: body.previewDigest,
      eventCount: body.eventCount,
      events,
      issuedAt: new Date(issuedAt).toISOString(),
      expiresAt: new Date(expiresAt).toISOString(),
      acknowledgement: CONFIRMATION_ACKNOWLEDGEMENT,
    },
  };
}

function canonicalEvents(events: ConfirmationSnapshotEvent[]): ConfirmationSnapshotEvent[] {
  const next = events.map((event) => ({
    sourceEventId: requiredToken(event.sourceEventId, 40),
    fingerprint: requiredFingerprint(event.fingerprint),
  }));
  next.sort((a, b) => a.sourceEventId.localeCompare(b.sourceEventId));
  if (new Set(next.map((event) => event.sourceEventId)).size !== next.length) {
    throw new ConfirmationSnapshotError("malformed");
  }
  return next;
}

function signCanonical(canonical: string, secret: string): string {
  return createHmac("sha256", secret).update(canonical, "utf8").digest("hex");
}

function fixedEqual(provided: string, expected: string): boolean {
  const left = createHash("sha256").update(provided, "utf8").digest();
  const right = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(left, right);
}

function requiredToken(value: string, max: number): string {
  const trimmed = value.trim();
  if (!isToken(trimmed, max)) throw new ConfirmationSnapshotError("malformed");
  return trimmed;
}

function requiredInstant(value: string): string {
  const trimmed = value.trim();
  if (!CONFIRMED_AT_PATTERN.test(trimmed) || !Number.isFinite(Date.parse(trimmed))) {
    throw new ConfirmationSnapshotError("malformed");
  }
  return new Date(trimmed).toISOString();
}

function requiredDigest(value: string): string {
  const trimmed = value.trim();
  if (!DIGEST_PATTERN.test(trimmed)) throw new ConfirmationSnapshotError("malformed");
  return trimmed;
}

function requiredFingerprint(value: string): string {
  const trimmed = value.trim();
  if (!FINGERPRINT_PATTERN.test(trimmed)) throw new ConfirmationSnapshotError("malformed");
  return trimmed;
}

function isToken(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max && value === value.trim();
}

function sameKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return Object.fromEntries(entries.map(([key, entry]) => [key, sortValue(entry)]));
}
