"use client";

import { TeamWorkspaceMessage } from "@/components/team-workspace/workspace-states";

export default function TeamWorkspaceError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <TeamWorkspaceMessage
      title="Team Workspace could not be displayed"
      body="Refresh this page and try again. Nothing was saved."
      onRetry={reset}
    />
  );
}
