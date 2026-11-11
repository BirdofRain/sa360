import "server-only";

import { fetchOnboardingSummary } from "@/lib/admin-api/client-onboarding-v2";
import { fetchAdminClientSourceFunnels } from "@/lib/admin-api/source-funnels-server";
import { adminFetchJson, fetchAdminClientDetail, fetchAdminClientSetup, fetchAdminClients, isAdminApiConfigured } from "@/lib/admin-api/server";
import { requireStaffWorkspacePermission } from "@/lib/admin-coc-session-guard";
import { isNativeClientSetupEnabled } from "@/lib/clients/native-client-setup-env";

import { isTeamWorkspaceEnabled } from "./config";
import { normalizeTeamWorkspaceClientId } from "./contract";
import { guidedOnboardingFromReads } from "./onboarding-guide";
import { assembleTeamWorkspaceDetail, projectClientOptions, projectRoutingRules } from "./present";
import { parseTeamWorkspaceResponse, readAdminErrorCode } from "./parse";
import { parseSourceCampaignReview, unavailableSourceCampaignReview, type SourceCampaignReviewView } from "./source-campaign-review";
import {
  disabledSourceCampaignRequest,
  parseSourceCampaignRequestHead,
  sourceCampaignRequestBlockedReason,
  sourceCampaignRequestPath,
  type SourceCampaignRequestView,
} from "./source-campaign-request";
import type {
  AccountSlice,
  OnboardingSlice,
  TeamWorkspaceDetailModel,
  TeamWorkspaceIndexModel,
  WorkspaceAvailability,
} from "./types";

const CLIENT_LIST_ERROR = "The client list could not be loaded.";

export async function loadTeamWorkspaceIndex(): Promise<TeamWorkspaceIndexModel> {
  await requireStaffWorkspacePermission("team_workspace");
  if (!isTeamWorkspaceEnabled()) return { kind: "disabled" };
  if (!isAdminApiConfigured()) {
    return { kind: "error", message: "The admin API is not configured for this app." };
  }
  const result = await fetchAdminClients();
  if (!result.data) return { kind: "error", message: CLIENT_LIST_ERROR };
  return { kind: "ready", clients: projectClientOptions(result.data.items) };
}

export async function loadTeamWorkspaceClient(rawId: string): Promise<TeamWorkspaceDetailModel> {
  await requireStaffWorkspacePermission("team_workspace");
  if (!isTeamWorkspaceEnabled()) return { kind: "disabled" };
  const clientAccountId = normalizeTeamWorkspaceClientId(rawId);
  if (!clientAccountId) return { kind: "invalid_client" };
  if (!isAdminApiConfigured()) {
    return { kind: "error", message: "The admin API is not configured for this app." };
  }

  const setupEnabled = isNativeClientSetupEnabled();
  const [workspaceResult, detail, onboarding, list, setupResult, sourceResult] = await Promise.all([
    adminFetchJson<unknown>(`/admin/v1/team-workspace/clients/${encodeURIComponent(clientAccountId)}`),
    fetchAdminClientDetail(clientAccountId),
    fetchOnboardingSummary(clientAccountId),
    fetchAdminClients(),
    setupEnabled ? fetchAdminClientSetup(clientAccountId) : Promise.resolve(null),
    fetchAdminClientSourceFunnels(clientAccountId),
  ]);

  const workspace = narrowWorkspace(clientAccountId, workspaceResult);
  const onboardingSlice = narrowOnboarding(onboarding);
  const assembled = assembleTeamWorkspaceDetail({
    clientAccountId,
    clients: list.data ? projectClientOptions(list.data.items) : [],
    workspace,
    account: narrowAccount(detail.data?.item),
    onboarding: onboardingSlice,
  });
  if (assembled.kind !== "ready") return assembled;
  const sourceCampaignReview = await loadSourceCampaignReview(clientAccountId, setupEnabled, setupResult);
  const sourceCampaignRequest = await loadSourceCampaignRequest(clientAccountId, workspace);
  return {
    ...assembled,
    guide: {
      ...guidedOnboardingFromReads({
        clientAccountId,
        setupEnabled,
        account: detail.data?.item ?? null,
        setupItem: setupResult?.data?.item ?? null,
        setupError: setupResult && !setupResult.data ? setupResult.error : null,
        sourceBody: sourceResult.data,
        sourceError: sourceResult.error,
        destinations: workspace.availability === "ready" ? workspace.body.destinations : null,
        recordedSetup: workspace.availability === "ready" ? workspace.body.setupRequest : null,
        verification: onboardingSlice,
      }),
      sourceCampaignReview,
      sourceCampaignRequest,
    },
  };
}

async function loadSourceCampaignRequest(
  clientAccountId: string,
  workspace: WorkspaceAvailability
): Promise<SourceCampaignRequestView> {
  const blocked = sourceCampaignRequestBlockedReason();
  if (blocked) return disabledSourceCampaignRequest(blocked);
  if (workspace.availability === "disabled") return disabledSourceCampaignRequest("workspace_api");
  const result = await adminFetchJson<unknown>(sourceCampaignRequestPath(clientAccountId));
  if (!result.ok) {
    const code = readAdminErrorCode(result.status, result.body);
    if (code === "source_campaign_request_disabled" || code === "feature_disabled") {
      return disabledSourceCampaignRequest("request_flag");
    }
    if (code === "team_workspace_disabled") return disabledSourceCampaignRequest("workspace_api");
    return {
      availability: "error",
      message: "The source and campaign request could not be loaded. Nothing was submitted.",
    };
  }
  return (
    parseSourceCampaignRequestHead(result.data) ?? {
      availability: "error",
      message: "The source and campaign request could not be read. Nothing was submitted.",
    }
  );
}

const SETUP_STATUSES = new Set(["draft", "submitted", "needs_information", "setup_reviewed"]);

function setupRevisionForReview(
  setupEnabled: boolean,
  setupResult: Awaited<ReturnType<typeof fetchAdminClientSetup>> | null
): { kind: "disabled" } | { kind: "revision"; revision: number } | { kind: "untrusted" } {
  if (!setupEnabled) return { kind: "disabled" };
  const item = setupResult?.data?.item;
  if (!setupResult || setupResult.error || !item || item.repairRequired === true) return { kind: "untrusted" };
  if (typeof item.revision !== "number" || !Number.isSafeInteger(item.revision) || item.revision < 0) return { kind: "untrusted" };
  if (!SETUP_STATUSES.has(item.status)) return { kind: "untrusted" };
  return { kind: "revision", revision: item.revision };
}

async function loadSourceCampaignReview(
  clientAccountId: string,
  setupEnabled: boolean,
  setupResult: Awaited<ReturnType<typeof fetchAdminClientSetup>> | null
): Promise<SourceCampaignReviewView> {
  const decision = setupRevisionForReview(setupEnabled, setupResult);
  if (decision.kind === "untrusted") {
    return unavailableSourceCampaignReview("The saved setup request could not be read. Nothing was verified.");
  }
  const path = `/admin/v1/team-workspace/clients/${encodeURIComponent(clientAccountId)}/source-campaign-review`;
  const url = decision.kind === "revision" ? `${path}?expectedRevision=${decision.revision}` : path;
  const result = await adminFetchJson<unknown>(url);
  const parsed = narrowReview(result);
  if (decision.kind === "disabled" && parsed.availability === "ready") {
    return unavailableSourceCampaignReview("The setup request could not be checked because native client setup is turned off. Nothing was verified.");
  }
  if (decision.kind === "revision" && parsed.revision !== decision.revision) {
    return unavailableSourceCampaignReview("The saved request changed. Reload before relying on this check. Nothing was verified.");
  }
  return parsed;
}

function narrowWorkspace(
  clientAccountId: string,
  result: Awaited<ReturnType<typeof adminFetchJson<unknown>>>
): WorkspaceAvailability {
  if (!result.ok) {
    const code = readAdminErrorCode(result.status, result.body);
    if (code === "team_workspace_disabled") return { availability: "disabled" };
    if (code === "client_not_found" || code === "not_found") return { availability: "not_found" };
    if (code === "forbidden") return { availability: "forbidden" };
    return { availability: "error", code };
  }
  const body = parseTeamWorkspaceResponse(result.data);
  if (!body || body.client.clientAccountId !== clientAccountId) {
    return { availability: "error", code: "malformed_response" };
  }
  return { availability: "ready", body };
}

function narrowReview(result: Awaited<ReturnType<typeof adminFetchJson<unknown>>>): SourceCampaignReviewView {
  if (!result.ok) {
    return unavailableSourceCampaignReview("The source and campaign check could not be loaded. Nothing was verified.");
  }
  return (
    parseSourceCampaignReview(result.data) ??
    unavailableSourceCampaignReview("The source and campaign check could not be read. Nothing was verified.")
  );
}

function narrowAccount(item: {
  clientDisplayName?: string;
  status?: string;
  routingRules?: {
    campaignName?: string | null;
    utmCampaign?: string | null;
    matchType?: string | null;
    active?: boolean;
  }[];
} | null | undefined): AccountSlice {
  if (!item || typeof item.clientDisplayName !== "string" || typeof item.status !== "string") {
    return { loaded: false };
  }
  return {
    loaded: true,
    clientDisplayName: item.clientDisplayName,
    status: item.status,
    rules: projectRoutingRules(item.routingRules ?? []),
  };
}

function narrowOnboarding(result: Awaited<ReturnType<typeof fetchOnboardingSummary>>): OnboardingSlice {
  if (!result.ok) {
    if (result.error === "onboarding_read_disabled") return { availability: "unavailable" };
    return { availability: "error" };
  }
  const linkedSources = result.data.sources.filter((source) => source.proofs.linked.satisfied === true).length;
  const blockers = result.data.blockers
    .filter((blocker): blocker is string => typeof blocker === "string" && /^[a-z0-9_]{1,80}$/.test(blocker))
    .slice(0, 8);
  return { availability: "ready", linkedSources, blockers };
}
