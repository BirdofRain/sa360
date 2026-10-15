import "server-only";

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";

/**
 * Scrypt verifier for SA360_META_REVIEWER_PASSWORD.
 *
 * Encoding matches `apps/api/src/lib/portal-password.ts` so there is one
 * password-verifier format in the repo. Admin C.O.C. does not import the API
 * package. A cross-package test locks the two implementations together.
 *
 * Stored format:
 *   scrypt$n=<N>$r=<r>$p=<p>$keylen=<k>$<salt_b64url>$<dk_b64url>
 *
 * Do not log passwords or verifiers.
 */

const ALG = "scrypt";
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 32;
const SALT_BYTES = 16;
const MAX_PASSWORD_CHARS = 1024;
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

const ENCODED_RE =
  /^scrypt\$n=(\d+)\$r=(\d+)\$p=(\d+)\$keylen=(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/;

const N_MIN = 4096;
const N_MAX = 1 << 20;
const R_MAX = 16;
const P_MAX = 4;
const KEYLEN_MIN = 16;
const KEYLEN_MAX = 64;

function encodePart(buf: Buffer): string {
  return buf.toString("base64url");
}

function decodePart(value: string): Buffer | null {
  try {
    const buf = Buffer.from(value, "base64url");
    return buf.length > 0 ? buf : null;
  } catch {
    return null;
  }
}

function isPowerOfTwo(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

function derive(
  password: string,
  salt: Buffer,
  n: number,
  r: number,
  p: number,
  keylen: number
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      keylen,
      { N: n, r, p, maxmem: SCRYPT_MAXMEM },
      (err, derivedKey) => {
        if (err || !derivedKey) {
          reject(err ?? new Error("scrypt_failed"));
          return;
        }
        resolve(derivedKey as Buffer);
      }
    );
  });
}

export async function hashMetaReviewerPassword(password: string): Promise<string> {
  if (typeof password !== "string" || password.length === 0 || password.length > MAX_PASSWORD_CHARS) {
    throw new Error("meta_reviewer_password_invalid");
  }
  const salt = randomBytes(SALT_BYTES);
  const dk = await derive(password, salt, N, R, P, KEYLEN);
  return `${ALG}$n=${N}$r=${R}$p=${P}$keylen=${KEYLEN}$${encodePart(salt)}$${encodePart(dk)}`;
}

function paramsSafe(n: number, r: number, p: number, keylen: number): boolean {
  if (!Number.isInteger(n) || !isPowerOfTwo(n) || n < N_MIN || n > N_MAX) return false;
  if (!Number.isInteger(r) || r < 1 || r > R_MAX) return false;
  if (!Number.isInteger(p) || p < 1 || p > P_MAX) return false;
  if (!Number.isInteger(keylen) || keylen < KEYLEN_MIN || keylen > KEYLEN_MAX) return false;
  return true;
}

/** True only when `password` matches a scrypt verifier. Plaintext config never matches. */
export async function verifyMetaReviewerPassword(
  password: string,
  storedHash: string | null | undefined
): Promise<boolean> {
  if (typeof password !== "string" || password.length === 0 || password.length > MAX_PASSWORD_CHARS) {
    return false;
  }
  if (typeof storedHash !== "string" || storedHash.length === 0) return false;

  const match = ENCODED_RE.exec(storedHash);
  if (!match) return false;

  const n = Number(match[1]);
  const r = Number(match[2]);
  const p = Number(match[3]);
  const keylen = Number(match[4]);
  if (!paramsSafe(n, r, p, keylen)) return false;

  const salt = decodePart(match[5] ?? "");
  const expected = decodePart(match[6] ?? "");
  if (!salt || !expected || expected.length !== keylen) return false;

  let derived: Buffer;
  try {
    derived = await derive(password, salt, n, r, p, keylen);
  } catch {
    return false;
  }

  if (derived.length !== expected.length) return false;
  try {
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}
