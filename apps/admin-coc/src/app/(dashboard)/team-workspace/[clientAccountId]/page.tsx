import {
  reloadDeliveryNotificationPreferenceAction,
  saveDeliveryNotificationPreferenceAction,
} from "@/app/actions/delivery-notification-preference";
import { issueSmsOptInLinkAction, readSmsConsentStatusAction, recordVerbalSmsConsentAction } from "@/app/actions/sms-verbal-consent";
import { AdminCocForbiddenError, readAdminCocAccess } from "@/lib/admin-coc-session-guard";
import { loadTeamWorkspaceClient } from "@/lib/team-workspace/load";
import { parseGuideStep } from "@/lib/team-workspace/onboarding-guide";

import { CampaignManager } from "@/components/team-workspace/campaign-manager";
import { GuidedOnboarding } from "@/components/team-workspace/guided-onboarding";
import { TeamWorkspaceBoard } from "@/components/team-workspace/workspace-board";
import { TeamWorkspaceDisabled, TeamWorkspaceIntro, TeamWorkspaceMessage } from "@/components/team-workspace/workspace-states";
import { isClientCampaignManagerEnabled } from "@/lib/team-workspace/client-campaign-manager-env";
import { loadClientCampaignManager } from "@/lib/team-workspace/client-campaign-manager-load";

export const dynamic = "force-dynamic";
export const metadata = { title: "Team Workspace" };

export default async function TeamWorkspaceClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientAccountId: string }>;
  searchParams: Promise<{ guide?: string | string[]; created?: string | string[] }>;
}) {
  const { clientAccountId } = await params;
  const { guide, created } = await searchParams;
  const requested = Array.isArray(guide) ? guide[0] : guide;
  const createdFlag = Array.isArray(created) ? created[0] : created;
  const step = parseGuideStep(requested) ?? "information";
  try {
    const access = await readAdminCocAccess();
    const canMutate =
      access.kind === "admin" || (access.kind === "staff_workspace" && access.permissions.includes("team_manager"));
    const webhookAccess = {
      canPrepare: canMutate,
      canActivate: access.kind === "admin",
    };
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
    const campaignManager = isClientCampaignManagerEnabled() ? await loadClientCampaignManager(clientAccountId) : null;
    return (
      <div className="space-y-8">
        {campaignManager ? <CampaignManager clientAccountId={clientAccountId} model={campaignManager} canMutate={canMutate} /> : null}
        {model.guide ? (
          <>
            <TeamWorkspaceIntro />
            <GuidedOnboarding model={model.guide} step={step} clients={model.clients} notice={createdFlag === "1" ? "created" : null} webhookAccess={webhookAccess} />
          </>
        ) : null}
        <TeamWorkspaceBoard
          showIntro={!model.guide}
          view={model.view}
          clients={model.clients}
          notificationActions={{
            save: saveDeliveryNotificationPreferenceAction,
            reload: reloadDeliveryNotificationPreferenceAction,
          }}
          smsActions={{
            recordVerbal: recordVerbalSmsConsentAction,
            issueLink: issueSmsOptInLinkAction,
            readStatus: readSmsConsentStatusAction,
          }}
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
