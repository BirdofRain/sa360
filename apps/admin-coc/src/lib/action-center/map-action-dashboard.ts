import type { AdminActionDashboardToday } from "@/lib/admin-api/types";
import { collectionAvailability, readArray } from "./defensive-payload";
import type {
  ActionCenterMappedDashboard,
  ActiveLeadWorkspaceItem,
  AiActivityFeedItem,
  GhlConnectionStatus,
  GhlConnectionStatusCode,
  PriorityCallItem,
} from "./types";

const KNOWN_CONNECTION_STATUSES = new Set<GhlConnectionStatusCode>([
  "connected",
  "degraded",
  "disconnected",
]);

type LooseActionDashboard = Partial<AdminActionDashboardToday> & {
  subaccount?: Partial<AdminActionDashboardToday["subaccount"]> | null;
  summary?: Partial<AdminActionDashboardToday["summary"]> | null;
};

function readKpi(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function presentGhlConnection(
  subaccount: LooseActionDashboard["subaccount"]
): { connection: GhlConnectionStatus; available: boolean } {
  if (!subaccount || typeof subaccount !== "object") {
    return {
      available: false,
      connection: {
        status: "unknown",
        rawStatus: "unavailable",
        locationId: "",
        locationName: "Connection details unavailable",
        lastSyncAt: null,
      },
    };
  }

  const raw = typeof subaccount.connectionStatus === "string" ? subaccount.connectionStatus : "";
  const known = KNOWN_CONNECTION_STATUSES.has(raw as GhlConnectionStatusCode);
  return {
    available: true,
    connection: {
      status: known ? (raw as GhlConnectionStatusCode) : "unknown",
      rawStatus: known ? undefined : raw || "unspecified",
      locationId: typeof subaccount.locationId === "string" ? subaccount.locationId : "",
      locationName:
        typeof subaccount.locationName === "string" && subaccount.locationName.trim()
          ? subaccount.locationName
          : "Unknown location",
      lastSyncAt: typeof subaccount.lastSyncAt === "string" ? subaccount.lastSyncAt : null,
      message: subaccount.syncMessage ?? undefined,
    },
  };
}

export function mapActionDashboardToUi(
  api: LooseActionDashboard | null | undefined
): ActionCenterMappedDashboard {
  const payload = api ?? {};
  const { subaccount, summary } = payload;
  const leads = readArray<NonNullable<AdminActionDashboardToday["priorityLeads"]>[number]>(
    payload.priorityLeads
  );
  const activity = readArray<NonNullable<AdminActionDashboardToday["aiActivity"]>[number]>(
    payload.aiActivity
  );
  const warnings = readArray<string>(payload.setupWarnings);
  const ghl = presentGhlConnection(subaccount);
  const kpisAvailable = Boolean(summary && typeof summary === "object");

  const priorityCalls: PriorityCallItem[] = leads.items.map((lead) => ({
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

  const activeLeads: ActiveLeadWorkspaceItem[] = leads.items
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

  const aiActivityFeed: AiActivityFeedItem[] = activity.items.map((item) => ({
    id: item.id,
    at: item.at,
    kind: item.kind,
    title: item.title,
    detail: item.detail,
    contactIdGhl: item.contactIdGhl,
    displayName: item.displayName,
  }));

  return {
    setupWarnings: warnings.items.filter((w) => typeof w === "string"),
    ok: true,
    generatedAt: typeof payload.generatedAt === "string" ? payload.generatedAt : "",
    clientAccountId:
      typeof subaccount?.clientAccountId === "string" ? subaccount.clientAccountId : "",
    locationId: typeof subaccount?.locationId === "string" ? subaccount.locationId : null,
    agentDisplayName:
      typeof subaccount?.agentDisplayName === "string" ? subaccount.agentDisplayName : null,
    ghlConnection: ghl.connection,
    kpis: {
      aiAppointmentsToday: readKpi(summary?.aiAppointmentsToday),
      hotActionsWaiting: readKpi(summary?.hotActionsWaiting),
      callsLoggedToday: readKpi(summary?.callsLoggedToday),
      revenueSignalsToday: readKpi(summary?.revenueSignalsToday),
    },
    priorityCalls,
    activeLeads,
    aiActivityFeed,
    sections: {
      ghlConnection: ghl.available ? "ok" : "unavailable",
      kpis: kpisAvailable ? "ok" : "unavailable",
      priorityCalls: collectionAvailability(leads.available, priorityCalls.length),
      activeLeads: collectionAvailability(leads.available, activeLeads.length),
      aiActivity: collectionAvailability(activity.available, aiActivityFeed.length),
      setupWarnings: collectionAvailability(warnings.available, warnings.items.length),
    },
  };
}
