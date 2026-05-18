import type { AdminActionDashboardToday } from "@/lib/admin-api/types";
import type {
  ActionCenterDashboardResponse,
  ActiveLeadWorkspaceItem,
  AiActivityFeedItem,
  GhlConnectionStatus,
  PriorityCallItem,
} from "./types";

export function mapActionDashboardToUi(
  api: AdminActionDashboardToday
): ActionCenterDashboardResponse & { setupWarnings: string[] } {
  const { subaccount, summary, priorityLeads, aiActivity } = api;

  const ghlConnection: GhlConnectionStatus = {
    status: subaccount.connectionStatus,
    locationId: subaccount.locationId,
    locationName: subaccount.locationName,
    lastSyncAt: subaccount.lastSyncAt,
    message: subaccount.syncMessage ?? undefined,
  };

  const priorityCalls: PriorityCallItem[] = priorityLeads.map((lead) => ({
    rank: lead.rank,
    priorityScore: lead.priorityScore,
    contactIdGhl: lead.contactIdGhl,
    leadUid: lead.leadUid,
    displayName: lead.displayName,
    phoneE164: lead.phoneE164,
    reason: lead.reason,
    reasonCode: lead.reasonCode,
    dueBy: lead.dueBy,
    estimatedPremium: lead.estimatedPremium,
    lifecycleStage: lead.lifecycleStage,
    lastTouchAt: lead.lastTouchAt,
    appointmentStatus: lead.workspace?.appointmentStatus ?? null,
  }));

  const activeLeads: ActiveLeadWorkspaceItem[] = priorityLeads
    .filter((lead): lead is typeof lead & { workspace: NonNullable<typeof lead.workspace> } =>
      Boolean(lead.workspace)
    )
    .map((lead) => ({
      contactIdGhl: lead.contactIdGhl,
      leadUid: lead.leadUid,
      phoneE164: lead.phoneE164,
      displayName: lead.displayName,
      lifecycleStage: lead.lifecycleStage ?? "—",
      appointmentStatus: lead.workspace.appointmentStatus,
      policyStatus: lead.workspace.policyStatus,
      nextAction: lead.workspace.nextAction,
      lastActivityAt: lead.workspace.lastActivityAt,
      ownerName: lead.workspace.ownerName,
    }));

  const aiActivityFeed: AiActivityFeedItem[] = aiActivity.map((item) => ({
    id: item.id,
    at: item.at,
    kind: item.kind,
    title: item.title,
    detail: item.detail,
    contactIdGhl: item.contactIdGhl,
    displayName: item.displayName,
  }));

  return {
    setupWarnings: api.setupWarnings,
    ok: true,
    generatedAt: api.generatedAt,
    clientAccountId: subaccount.clientAccountId,
    locationId: subaccount.locationId,
    agentDisplayName: subaccount.agentDisplayName,
    ghlConnection,
    kpis: {
      aiAppointmentsToday: summary.aiAppointmentsToday,
      hotActionsWaiting: summary.hotActionsWaiting,
      callsLoggedToday: summary.callsLoggedToday,
      revenueSignalsToday: summary.revenueSignalsToday,
    },
    priorityCalls,
    activeLeads,
    aiActivityFeed,
  };
}
