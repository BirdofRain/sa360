import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

/**
 * Portal password hashing (per-ClientAccount).
 *
 * Node `scrypt` is used instead of argon2id: this monorepo has no native addons,
 * DigitalOcean + Next.js bundling of argon2 bindings is a compatibility risk, and
 * `node:crypto` scrypt is memory-hard, salted, and available on Node 22 without
 * extra packages. Parameters are stored in a versioned encoded string so they
 * can be raised later without a format break.
 *
 * Stored format:
 *   scrypt$n=<N>$r=<r>$p=<p>$keylen=<k>$<salt_b64url>$<dk_b64url>
 *
 * Do not log passwords or hashes.
 */

const scrypt = promisify(scryptCallback);

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

export function isPortalPasswordBound(storedHash: string | null | undefined): boolean {
  return storedHash != null;
}

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

async function derive(
  password: string,
  salt: Buffer,
  n: number,
  r: number,
  p: number,
  keylen: number
): Promise<Buffer> {
  return scrypt(password, salt, keylen, { N: n, r, p, maxmem: SCRYPT_MAXMEM }) as Promise<Buffer>;
}

export async function hashPortalPassword(password: string): Promise<string> {
  if (typeof password !== "string" || password.length === 0 || password.length > MAX_PASSWORD_CHARS) {
    throw new Error("portal_password_invalid");
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

export async function verifyPortalPassword(
  password: string,
  storedHash: string | null | undefined
): Promise<boolean> {
  if (typeof password !== "string" || password.length === 0 || password.length > MAX_PASSWORD_CHARS) {
    return false;
  }
  if (typeof storedHash !== "string" || storedHash.length === 0) {
    return false;
  }

  const match = ENCODED_RE.exec(storedHash);
  if (!match) return false;

  const n = Number(match[1]);
  const r = Number(match[2]);
  const p = Number(match[3]);
  const keylen = Number(match[4]);
  if (!paramsSafe(n, r, p, keylen)) return false;

  const salt = decodePart(match[5]);
  const expected = decodePart(match[6]);
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
