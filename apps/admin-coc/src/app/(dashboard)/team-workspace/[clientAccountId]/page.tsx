import { AdminCocForbiddenError } from "@/lib/admin-coc-session-guard";
import { loadTeamWorkspaceClient } from "@/lib/team-workspace/load";

import { TeamWorkspaceBoard } from "@/components/team-workspace/workspace-board";
import { TeamWorkspaceDisabled, TeamWorkspaceIntro, TeamWorkspaceMessage } from "@/components/team-workspace/workspace-states";

export const dynamic = "force-dynamic";
export const metadata = { title: "Team Workspace" };

export default async function TeamWorkspaceClientPage({
  params,
}: {
  params: Promise<{ clientAccountId: string }>;
}) {
  const { clientAccountId } = await params;
  try {
    const model = await loadTeamWorkspaceClient(clientAccountId);
    if (model.kind === "disabled") return <TeamWorkspaceDisabled />;
    if (model.kind === "invalid_client") {
      return (
        <TeamWorkspaceMessage
          title="That client id is not valid"
          body="Choose a client from Team Workspace. Nothing was loaded for this address."
          retryHref="/team-workspace"
        />
      );
    }
    if (model.kind === "not_found") {
      return (
        <TeamWorkspaceMessage
          title="Client not found"
          body="No client matches this id. Nothing was changed."
          retryHref="/team-workspace"
        />
      );
    }
    if (model.kind === "forbidden") {
      return (
        <TeamWorkspaceMessage
          title="Admin session required"
          body="This session cannot read Team Workspace."
          retryHref="/team-workspace"
        />
      );
    }
    if (model.kind === "error") {
      return (
        <div className="space-y-6">
          <TeamWorkspaceIntro />
          <TeamWorkspaceMessage title="Team Workspace could not be loaded" body={model.message} retryHref="/team-workspace" />
        </div>
      );
    }
    return <TeamWorkspaceBoard view={model.view} clients={model.clients} />;
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
