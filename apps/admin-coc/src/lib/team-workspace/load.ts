import "server-only";

import { fetchOnboardingSummary } from "@/lib/admin-api/client-onboarding-v2";
import { fetchAdminClientSourceFunnels } from "@/lib/admin-api/source-funnels-server";
import { adminFetchJson, fetchAdminClientDetail, fetchAdminClientSetup, fetchAdminClients, isAdminApiConfigured } from "@/lib/admin-api/server";
import { requireAdminCocAdminSession } from "@/lib/admin-coc-session-guard";
import { isNativeClientSetupEnabled } from "@/lib/clients/native-client-setup-env";

import { isTeamWorkspaceEnabled } from "./config";
import { normalizeTeamWorkspaceClientId } from "./contract";
import { guidedOnboardingFromReads } from "./onboarding-guide";
import { assembleTeamWorkspaceDetail, projectClientOptions, projectRoutingRules } from "./present";
import { parseTeamWorkspaceResponse, readAdminErrorCode } from "./parse";
import { parseSourceCampaignReview, unavailableSourceCampaignReview, type SourceCampaignReviewView } from "./source-campaign-review";
import type {
  AccountSlice,
  OnboardingSlice,
  TeamWorkspaceDetailModel,
  TeamWorkspaceIndexModel,
  WorkspaceAvailability,
} from "./types";

const CLIENT_LIST_ERROR = "The client list could not be loaded.";

export async function loadTeamWorkspaceIndex(): Promise<TeamWorkspaceIndexModel> {
  await requireAdminCocAdminSession();
  if (!isTeamWorkspaceEnabled()) return { kind: "disabled" };
  if (!isAdminApiConfigured()) {
    return { kind: "error", message: "The admin API is not configured for this app." };
  }
  const result = await fetchAdminClients();
  if (!result.data) return { kind: "error", message: CLIENT_LIST_ERROR };
  return { kind: "ready", clients: projectClientOptions(result.data.items) };
}

export async function loadTeamWorkspaceClient(rawId: string): Promise<TeamWorkspaceDetailModel> {
  await requireAdminCocAdminSession();
  if (!isTeamWorkspaceEnabled()) return { kind: "disabled" };
  const clientAccountId = normalizeTeamWorkspaceClientId(rawId);
  if (!clientAccountId) return { kind: "invalid_client" };
  if (!isAdminApiConfigured()) {
    return { kind: "error", message: "The admin API is not configured for this app." };
  }

  const setupEnabled = isNativeClientSetupEnabled();
  const [workspaceResult, detail, onboarding, list, setupResult, sourceResult, reviewResult] = await Promise.all([
    adminFetchJson<unknown>(`/admin/v1/team-workspace/clients/${encodeURIComponent(clientAccountId)}`),
    fetchAdminClientDetail(clientAccountId),
    fetchOnboardingSummary(clientAccountId),
    fetchAdminClients(),
    setupEnabled ? fetchAdminClientSetup(clientAccountId) : Promise.resolve(null),
    fetchAdminClientSourceFunnels(clientAccountId),
    adminFetchJson<unknown>(`/admin/v1/team-workspace/clients/${encodeURIComponent(clientAccountId)}/source-campaign-review`),
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
      sourceCampaignReview: narrowReview(reviewResult),
    },
  };
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
