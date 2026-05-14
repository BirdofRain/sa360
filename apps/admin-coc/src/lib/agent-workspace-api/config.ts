import "server-only";

import { getSa360PublicApiBaseUrl } from "../sa360-public-api-base-url";

/** Must match `apps/api` (`workspace-auth.ts`). */
export const WORKSPACE_KEY_HEADER = "x-sa360-workspace-key";

export function getAgentWorkspaceApiBaseUrl(): string | undefined {
  return getSa360PublicApiBaseUrl();
}

/**
 * Server-only key to call `/agent-workspace/v1`.
 * Prefer `SA360_AGENT_WORKSPACE_API_KEY`; falls back to `AGENT_WORKSPACE_API_KEY`.
 */
export function getAgentWorkspaceApiKey(): string | undefined {
  const a = process.env.SA360_AGENT_WORKSPACE_API_KEY?.trim();
  const b = process.env.AGENT_WORKSPACE_API_KEY?.trim();
  return a || b || undefined;
}

export function isAgentWorkspaceApiConfigured(): boolean {
  return Boolean(getAgentWorkspaceApiBaseUrl() && getAgentWorkspaceApiKey());
}

export async function workspaceProxyFetch(
  pathWithQuery: string,
  init?: RequestInit
): Promise<Response> {
  const baseUrl = getAgentWorkspaceApiBaseUrl();
  const apiKey = getAgentWorkspaceApiKey();
  if (!baseUrl || !apiKey) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "Agent Workspace API is not configured",
        hint: "Set NEXT_PUBLIC_SA360_API_BASE_URL (or NEXT_PUBLIC_API_BASE_URL) and SA360_AGENT_WORKSPACE_API_KEY (or AGENT_WORKSPACE_API_KEY).",
      }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  const url = `${baseUrl}${pathWithQuery.startsWith("/") ? pathWithQuery : `/${pathWithQuery}`}`;
  const headers = new Headers(init?.headers);
  headers.set(WORKSPACE_KEY_HEADER, apiKey);
  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }

  return fetch(url, {
    ...init,
    headers,
    cache: "no-store",
  });
}
