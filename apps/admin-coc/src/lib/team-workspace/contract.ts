export const TEAM_WORKSPACE_CONTRACT_VERSION = "team_workspace_delivery_v1" as const;

/** One path segment. Matches the API client id check. */
export const TEAM_WORKSPACE_CLIENT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export const TEAM_WORKSPACE_STEP_IDS = [
  "client_information",
  "lead_source",
  "delivery_destination",
  "delivery_notifications",
  "setup_verification",
  "completion",
] as const;

export type TeamWorkspaceStepId = (typeof TEAM_WORKSPACE_STEP_IDS)[number];

export function normalizeTeamWorkspaceClientId(raw: string): string | null {
  let id = raw;
  try {
    id = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (!TEAM_WORKSPACE_CLIENT_ID.test(id)) return null;
  return id;
}

export function isSafeTeamWorkspaceId(value: unknown): value is string {
  return typeof value === "string" && TEAM_WORKSPACE_CLIENT_ID.test(value);
}
