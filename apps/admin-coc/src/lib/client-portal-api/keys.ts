import { getSa360PublicApiBaseUrl } from "../sa360-public-api-base-url.ts";

export const CLIENT_PORTAL_KEY_HEADER = "x-sa360-client-portal-key";

export function getClientPortalApiKey(): string | undefined {
  return process.env.CLIENT_PORTAL_API_KEY?.trim() || undefined;
}

export function isClientPortalApiConfigured(): boolean {
  return Boolean(getSa360PublicApiBaseUrl() && getClientPortalApiKey());
}
