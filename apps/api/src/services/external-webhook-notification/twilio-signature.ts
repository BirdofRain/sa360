import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Twilio signs the public URL plus the POST fields in sorted key order.
 * The auth token is the HMAC key and is not returned.
 */
export function twilioRequestSignature(
  url: string,
  params: Record<string, string>,
  authToken: string
): string {
  const keys = Object.keys(params).sort();
  let payload = url;
  for (const key of keys) payload += key + params[key];
  return createHmac("sha1", authToken).update(payload, "utf8").digest("base64");
}

export function twilioSignatureMatches(
  url: string,
  params: Record<string, string>,
  signature: string | undefined,
  authToken: string
): boolean {
  if (!signature || !authToken || !url) return false;
  const expected = twilioRequestSignature(url, params, authToken);
  const left = Buffer.from(expected);
  const right = Buffer.from(signature);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
