/**
 * Team Workspace API gate.
 *
 * Only trim() equal to the exact string "true" enables the API.
 * Unset, blank, TRUE, 1, yes, and on stay off.
 *
 * PR #292 defines this same predicate as `isTeamWorkspaceApiEnabled` in
 * `services/team-workspace/team-workspace-read.ts`. That file is not on this
 * branch. After #292 is on master, keep one definition and call it from the other.
 */
export function isTeamWorkspaceApiEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SA360_TEAM_WORKSPACE_ENABLED?.trim() === "true";
}
