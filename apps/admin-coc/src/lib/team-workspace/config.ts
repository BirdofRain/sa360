/**
 * Team Workspace shell flag.
 * Exact `true` after trim. `TRUE`, `1`, `yes`, and `on` stay off.
 * This does not authorize the API. The server flag and the admin session do.
 */
export function isTeamWorkspaceEnabled(): boolean {
  return process.env.NEXT_PUBLIC_SA360_TEAM_WORKSPACE_ENABLED?.trim() === "true";
}
