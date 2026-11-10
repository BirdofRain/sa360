import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * One-time staff enrollment materials. The invitation secret is shown once
 * to the issuer and is never stored. This module does not bind a Google
 * subject and does not grant a permission.
 */

export const STAFF_ENROLLMENT_FLAG = "SA360_STAFF_ENROLLMENT_ENABLED";
export const STAFF_ENROLLMENT_ISSUER_SECRET_ENV = "SA360_STAFF_ENROLLMENT_ISSUER_SECRET";
export const STAFF_ENROLLMENT_ISSUER_HEADER = "x-sa360-staff-enrollment-issuer";
export const STAFF_ENROLLMENT_TTL_SECONDS = 15 * 60;
export const STAFF_ENROLLMENT_SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const ISSUER_MIN_LENGTH = 32;
const FORBIDDEN_ENV_KEYS = [
  "ADMIN_API_KEY",
  "SA360_ADMIN_KEY",
  "SA360_ADMIN_API_KEY",
  "ADMIN_COC_SESSION_SECRET",
  "ADMIN_COC_PASSWORD",
  "CLIENT_PORTAL_API_KEY",
  "AGENT_WORKSPACE_API_KEY",
  "SA360_WORKSPACE_SECRET",
  "SA360_STAFF_SESSION_SECRET",
  "SA360_STAFF_GOOGLE_SERVICE_SECRET",
  "SA360_STAFF_ASSERTION_SECRET",
] as const;

export function staffEnrollmentEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[STAFF_ENROLLMENT_FLAG] === "true";
}

export function createStaffEnrollmentSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function staffEnrollmentSecretDigest(secret: string): string | null {
  if (!STAFF_ENROLLMENT_SECRET_PATTERN.test(secret)) return null;
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function readStaffEnrollmentIssuerSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const value = env[STAFF_ENROLLMENT_ISSUER_SECRET_ENV];
  if (!acceptableSecret(value)) return null;
  if (!distinctFromOtherCredentials(value, env)) return null;
  return value;
}

export function staffEnrollmentIssuerHeaderMatches(provided: string, expected: string): boolean {
  return fixedEqual(provided, expected);
}

function acceptableSecret(value: unknown): value is string {
  return typeof value === "string" && value.length >= ISSUER_MIN_LENGTH && value.length <= 512 && !/\s/u.test(value);
}

function distinctFromOtherCredentials(secret: string, env: NodeJS.ProcessEnv): boolean {
  let distinct = true;
  let compared = false;
  for (const key of FORBIDDEN_ENV_KEYS) {
    const other = env[key];
    if (typeof other !== "string" || other.length === 0) continue;
    compared = true;
    if (fixedEqual(secret, other)) distinct = false;
  }
  if (!compared) fixedEqual(secret, "sa360-staff-enrollment-issuer-unset");
  return distinct;
}

function fixedEqual(provided: string, expected: string): boolean {
  const left = createHash("sha256").update(provided, "utf8").digest();
  const right = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(left, right);
}
