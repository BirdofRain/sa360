/**
 * Team Workspace API gate. The read module re-exports this function.
 *
 * Only trim() equal to the exact string "true" enables the API.
 * Unset, blank, TRUE, 1, yes, and on stay off.
 */
export function isTeamWorkspaceApiEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SA360_TEAM_WORKSPACE_ENABLED?.trim() === "true";
}
