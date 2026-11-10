/**
 * Team Workspace shell flag.
 * Exact `true` after trim. `TRUE`, `1`, `yes`, and `on` stay off.
 * This does not authorize the API. The server flag and the admin session do.
 */
export function isTeamWorkspaceEnabled(): boolean {
  return process.env.NEXT_PUBLIC_SA360_TEAM_WORKSPACE_ENABLED?.trim() === "true";
}

/**
 * API Team Workspace gate, read by this server before it calls the request route.
 * Exact `true` after trim. The public flag does not satisfy this check.
 */
export function isTeamWorkspaceServerEnabled(): boolean {
  return process.env.SA360_TEAM_WORKSPACE_ENABLED?.trim() === "true";
}
