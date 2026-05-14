/**
 * Browser-visible API origin for the Fastify SA360 API.
 * Prefer `NEXT_PUBLIC_SA360_API_BASE_URL`; fall back to `NEXT_PUBLIC_API_BASE_URL` for legacy setups.
 */
export function getSa360PublicApiBaseUrl(): string | undefined {
  const raw =
    process.env.NEXT_PUBLIC_SA360_API_BASE_URL?.trim() || process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  if (!raw) return undefined;
  return raw.replace(/\/+$/, "");
}
