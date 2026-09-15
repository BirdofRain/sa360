/** Fields that must never appear in ordinary API/model presenters. */
export const TOKEN_FIELD_DENYLIST = new Set([
  "accessTokenEncrypted",
  "refreshTokenEncrypted",
  "pkceVerifierEncrypted",
  "codeVerifierEncrypted",
  "access_token",
  "refresh_token",
  "id_token",
  "idToken",
  "accessToken",
  "refreshToken",
  "clientSecret",
  "client_secret",
  "pkceVerifier",
  "codeVerifier",
  "code_verifier",
]);

export function assertNoTokenFieldsInPayload(obj: Record<string, unknown>): void {
  for (const key of Object.keys(obj)) {
    if (TOKEN_FIELD_DENYLIST.has(key)) {
      throw new Error(`Token field leaked in API response: ${key}`);
    }
  }
}

export function payloadContainsPlaintextSecret(
  payload: unknown,
  secrets: string[]
): boolean {
  const serialized = JSON.stringify(payload);
  return secrets.some((secret) => secret.length > 0 && serialized.includes(secret));
}
