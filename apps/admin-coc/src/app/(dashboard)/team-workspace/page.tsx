import { AdminCocForbiddenError } from "@/lib/admin-coc-session-guard";
import { loadTeamWorkspaceIndex } from "@/lib/team-workspace/load";

import { TeamWorkspaceHome } from "@/components/team-workspace/workspace-board";
import { TeamWorkspaceDisabled, TeamWorkspaceIntro, TeamWorkspaceMessage } from "@/components/team-workspace/workspace-states";

export const dynamic = "force-dynamic";
export const metadata = { title: "Team Workspace" };

export default async function TeamWorkspacePage() {
  try {
    const model = await loadTeamWorkspaceIndex();
    if (model.kind === "disabled") return <TeamWorkspaceDisabled />;
    if (model.kind === "error") {
      return (
        <div className="space-y-6">
          <TeamWorkspaceIntro />
          <TeamWorkspaceMessage title="Clients could not be loaded" body={model.message} retryHref="/team-workspace" />
        </div>
      );
    }
    if (model.clients.length === 0) {
      return (
        <div className="space-y-6">
          <TeamWorkspaceIntro />
          <TeamWorkspaceMessage
            title="No clients yet"
            body="There is no client to open. This page does not create one."
            retryHref="/team-workspace"
          />
        </div>
      );
    }
    return <TeamWorkspaceHome clients={model.clients} />;
  } catch (error) {
    if (error instanceof AdminCocForbiddenError) {
      return (
        <TeamWorkspaceMessage
          title="Admin session required"
          body="Team Workspace is an admin preview. Observers and portal sessions cannot open it."
        />
      );
    }
    throw error;
  }
}
