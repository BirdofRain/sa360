import { createHmac, timingSafeEqual } from "node:crypto";

const VERSION = "v1";
const MAX_CLOCK_SKEW_SECONDS = 30;
export const CLIENT_PORTAL_ASSERTION_MAX_AGE_SECONDS = 60;
export const CLIENT_PORTAL_ASSERTION_HEADER = "x-sa360-client-portal-assertion";

export type ClientPortalAssertion = {
  clientAccountId: string;
  portalSessionEpoch: number;
  iat: number;
  exp: number;
};

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  try {
    const aa = Buffer.from(a, "utf8");
    const bb = Buffer.from(b, "utf8");
    return aa.length === bb.length && timingSafeEqual(aa, bb);
  } catch {
    return false;
  }
}

export function createClientPortalAssertion(
  input: Pick<ClientPortalAssertion, "clientAccountId" | "portalSessionEpoch">,
  secret: string,
  nowSec = Math.floor(Date.now() / 1000)
): string {
  const clientAccountId = input.clientAccountId.trim();
  const signingSecret = secret.trim();
  if (!clientAccountId || !signingSecret) throw new Error("Portal assertion input is invalid.");
  if (!Number.isInteger(input.portalSessionEpoch) || input.portalSessionEpoch < 0) {
    throw new Error("Portal assertion epoch is invalid.");
  }
  const body = Buffer.from(
    JSON.stringify({
      clientAccountId,
      portalSessionEpoch: input.portalSessionEpoch,
      iat: nowSec,
      exp: nowSec + CLIENT_PORTAL_ASSERTION_MAX_AGE_SECONDS,
    } satisfies ClientPortalAssertion),
    "utf8"
  ).toString("base64url");
  const signed = `${VERSION}.${body}`;
  return `${signed}.${sign(signed, signingSecret)}`;
}

export function verifyClientPortalAssertion(
  token: string | undefined,
  secret: string,
  nowSec = Math.floor(Date.now() / 1000)
): ClientPortalAssertion | null {
  const signingSecret = secret.trim();
  if (!token?.trim() || !signingSecret) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) return null;
  const signed = `${parts[0]}.${parts[1]}`;
  if (!safeEqual(parts[2], sign(signed, signingSecret))) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8")
    ) as Partial<ClientPortalAssertion>;
    if (
      typeof parsed.clientAccountId !== "string" ||
      !parsed.clientAccountId.trim() ||
      !Number.isInteger(parsed.portalSessionEpoch) ||
      (parsed.portalSessionEpoch ?? -1) < 0 ||
      typeof parsed.iat !== "number" ||
      typeof parsed.exp !== "number" ||
      parsed.iat > nowSec + MAX_CLOCK_SKEW_SECONDS ||
      parsed.exp < nowSec ||
      parsed.exp - parsed.iat > CLIENT_PORTAL_ASSERTION_MAX_AGE_SECONDS
    ) {
      return null;
    }
    return {
      clientAccountId: parsed.clientAccountId.trim(),
      portalSessionEpoch: parsed.portalSessionEpoch as number,
      iat: parsed.iat,
      exp: parsed.exp,
    };
  } catch {
    return null;
  }
}
