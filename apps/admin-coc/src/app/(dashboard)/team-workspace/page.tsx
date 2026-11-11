import { AdminCocForbiddenError, readAdminCocAccess } from "@/lib/admin-coc-session-guard";
import { loadTeamWorkspaceIndex } from "@/lib/team-workspace/load";

import { GuidedOnboarding } from "@/components/team-workspace/guided-onboarding";
import { TeamWorkspaceHome } from "@/components/team-workspace/workspace-board";
import { TeamWorkspaceDisabled, TeamWorkspaceIntro, TeamWorkspaceMessage } from "@/components/team-workspace/workspace-states";

export const dynamic = "force-dynamic";
export const metadata = { title: "Team Workspace" };

export default async function TeamWorkspacePage() {
  const access = await readAdminCocAccess();
  const operationsOnly =
    access.kind === "staff_workspace" &&
    access.permissions.includes("team_operations") &&
    !access.permissions.includes("team_manager");
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
    return (
      <div className="space-y-4">
        {operationsOnly ? <OperationsNotice /> : null}
        <TeamWorkspaceHome
          clients={model.clients}
          start={<GuidedOnboarding model={null} step="client" clients={model.clients} />}
        />
      </div>
    );
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

function OperationsNotice() {
  return (
    <p className="rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
      Operations access can review client status in Team Workspace. Client setup, campaign requests,
      GoHighLevel configuration, and Company Sheets requests stay with a manager or administrator.
      Order creation and fulfillment execution are not available on this account.
    </p>
  );
}
