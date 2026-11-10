import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Server-to-server credential for the internal staff sign-in routes.
 * This is not a staff identity and it is not the shared admin API key.
 */

export const STAFF_GOOGLE_SERVICE_HEADER = "x-sa360-staff-google-service";
export const STAFF_GOOGLE_SERVICE_SECRET_ENV = "SA360_STAFF_GOOGLE_SERVICE_SECRET";
export const STAFF_GOOGLE_SERVICE_SECRET_MIN_LENGTH = 32;

const FORBIDDEN_ENV_KEYS = [
  "ADMIN_API_KEY",
  "SA360_ADMIN_KEY",
  "SA360_ADMIN_API_KEY",
  "ADMIN_COC_SESSION_SECRET",
  "CLIENT_PORTAL_API_KEY",
  "AGENT_WORKSPACE_API_KEY",
  "SA360_WORKSPACE_SECRET",
  "SA360_STAFF_SESSION_SECRET",
] as const;

export function readStaffGoogleServiceSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const value = env[STAFF_GOOGLE_SERVICE_SECRET_ENV];
  if (!acceptableSecret(value)) return null;
  if (!distinctFromOtherCredentials(value, env)) return null;
  return value;
}

export function staffGoogleServiceHeaderMatches(provided: string, expected: string): boolean {
  return fixedEqual(provided, expected);
}

function acceptableSecret(value: unknown): value is string {
  return typeof value === "string" && value.length >= STAFF_GOOGLE_SERVICE_SECRET_MIN_LENGTH && value.length <= 512 && !/\s/u.test(value);
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
  if (!compared) fixedEqual(secret, "sa360-staff-service-credential-unset");
  return distinct;
}

function fixedEqual(provided: string, expected: string): boolean {
  const left = createHash("sha256").update(provided, "utf8").digest();
  const right = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(left, right);
}
